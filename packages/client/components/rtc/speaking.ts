import { Accessor, createSignal, onCleanup } from "solid-js";
import { useIsSpeaking } from "solid-livekit-components";

import { LocalTrack, Participant, RemoteTrack, Track } from "livekit-client";

import { rms } from "./audioLevel";
import { sourceAge } from "./sourceAge";

/**
 * Speaking detection from audio levels in the client
 *
 * LiveKit's own speaking state comes from the server, which only sends
 * updates every few hundred ms after smoothing them, so the indicator showed
 * up around a second after someone started talking. Instead we read the
 * level of each microphone track directly. For our own track that is the
 * sender's stats. For remote tracks it is the RTP audio level header when the
 * server sends one (ours doesn't), otherwise the received track is measured
 * with Web Audio: an analyser on a shared AudioContext reads the RMS of the
 * samples. The analyser isn't connected to the output, playback stays with
 * RoomAudioManager (which keeps the track attached to a media element, also
 * while deafened, as Chrome only feeds remote WebRTC audio into Web Audio
 * then).
 *
 * Whenever the level can't be read, the server's speaking state is used.
 */

/**
 * How often levels are read
 */
const POLL_MS = 50;

/**
 * Level counted as speech, -35 dBov like the LiveKit server
 */
const SPEAKING_LEVEL = Math.pow(10, -35 / 20);

/**
 * Polls above the level needed to start speaking, filters out clicks
 */
const START_POLLS = 2;

/**
 * How long speaking lasts after the level drops, bridges pauses between words
 */
const HOLD_MS = 600;

/**
 * A remote level older than this is silence, with DTX no packets are sent
 * while silent so the last level would otherwise stick
 */
const STALE_MS = 300;

/**
 * How often a context that isn't running is asked to resume
 */
const RESUME_RETRY_MS = 1000;

/**
 * An analyser that read only silence samples for this long isn't fed anymore
 * (a real signal always has some noise), the server's state is used instead
 */
const ANALYSER_DEAD_MS = 1000;

/**
 * AudioContext shared by all analysers, created on first use
 */
let sharedContext: AudioContext | undefined;

/**
 * Get the shared AudioContext, trying to resume it if the browser suspended it
 * @returns The context, or undefined if Web Audio isn't available
 */
function getContext(): AudioContext | undefined {
  if (!sharedContext || sharedContext.state === "closed") {
    try {
      sharedContext = new AudioContext({ latencyHint: "playback" });
    } catch {
      return undefined;
    }
  }
  resumeContext(sharedContext);
  return sharedContext;
}

/**
 * Last time a resume was attempted
 */
let lastResume = 0;

/**
 * Try to resume a context that isn't running (suspended without a user
 * gesture, or interrupted on iOS), at most once per second. Failing is fine,
 * the server's speaking state is used meanwhile.
 * @param context Context
 */
function resumeContext(context: AudioContext) {
  if (context.state === "running") return;
  const now = Date.now();
  if (now - lastResume < RESUME_RETRY_MS) return;
  lastResume = now;
  context.resume().catch(() => {});
}

/**
 * Analyser measuring one received track
 */
type TrackAnalyser = {
  track: MediaStreamTrack;
  /** Kept referenced, Chrome can silence a source node once its stream is collected */
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  /** Last time a window had a non-zero sample, a starved graph reads only zeros */
  lastNonZero: number;
};

/**
 * Build an analyser for a received track
 * @param track Media stream track
 * @returns Analyser, or undefined if Web Audio isn't available
 */
function createAnalyser(track: MediaStreamTrack): TrackAnalyser | undefined {
  const context = getContext();
  if (!context) return undefined;

  try {
    const stream = new MediaStream([track]);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    return {
      track,
      stream,
      source,
      analyser,
      samples: new Float32Array(analyser.fftSize),
      lastNonZero: Date.now(),
    };
  } catch {
    return undefined;
  }
}

/**
 * Disconnect an analyser's nodes
 * @param analyser Analyser
 */
function destroyAnalyser(analyser: TrackAnalyser) {
  analyser.source.disconnect();
  analyser.analyser.disconnect();
}

/**
 * Read the level from an analyser
 * @param analyser Analyser
 * @returns RMS from 0 to 1, or undefined while the graph isn't flowing
 */
function readAnalyser(analyser: TrackAnalyser): number | undefined {
  if (!sharedContext || sharedContext.state !== "running") {
    if (sharedContext) resumeContext(sharedContext);
    // Count from when it runs again
    analyser.lastNonZero = Date.now();
    return undefined;
  }

  analyser.analyser.getFloatTimeDomainData(analyser.samples);
  const level = rms(analyser.samples);

  // A graph that stopped producing samples isn't flowing (detached element,
  // interrupted context), leave it to the server state
  const now = Date.now();
  if (level > 0) analyser.lastNonZero = now;
  return now - analyser.lastNonZero > ANALYSER_DEAD_MS ? undefined : level;
}

/**
 * Disconnect and forget a detector's analyser
 * @param analysers Analyser holder of the detector
 */
function clearAnalyser(analysers: { current?: TrackAnalyser }) {
  if (analysers.current) destroyAnalyser(analysers.current);
  analysers.current = undefined;
}

/**
 * Read the current microphone level of a participant
 * @param participant Participant
 * @param analysers Analyser of the detector, rebuilt when the track changes
 * @returns Level from 0 to 1, or undefined if it can't be read
 */
async function readLevel(
  participant: Participant,
  analysers: { current?: TrackAnalyser },
): Promise<number | undefined> {
  const publication = participant.getTrackPublication(Track.Source.Microphone);
  const track = publication?.track;
  if (!publication || publication.isMuted) {
    clearAnalyser(analysers);
    return 0;
  }
  if (!track) {
    clearAnalyser(analysers);
    return undefined;
  }

  if (track instanceof RemoteTrack) {
    const sources = track.receiver?.getSynchronizationSources?.() ?? [];

    const perfNow = performance.now();
    const epochNow = performance.timeOrigin + perfNow;

    // Without a fresh level (silence with DTX, or no audio level header)
    // the server's speaking state is used
    let level: number | undefined;
    for (const source of sources) {
      if (sourceAge(source.timestamp, perfNow, epochNow) > STALE_MS) continue;
      if (typeof source.audioLevel !== "number") continue;
      level = Math.max(level ?? 0, source.audioLevel);
    }
    if (level !== undefined) return level;

    // No RTP level, measure the received audio. The analyser is only built
    // now (not while RTP levels work) and then kept as the fallback for gaps
    // in the RTP levels, like DTX silence. The track changes on resubscribe,
    // so rebuild the nodes when it isn't the one measured.
    const mediaTrack = track.mediaStreamTrack;
    if (!mediaTrack || mediaTrack.readyState === "ended") {
      clearAnalyser(analysers);
      return undefined;
    }
    if (analysers.current?.track !== mediaTrack) {
      clearAnalyser(analysers);
      analysers.current = createAnalyser(mediaTrack);
    }
    return analysers.current ? readAnalyser(analysers.current) : undefined;
  }

  if (track instanceof LocalTrack) {
    const report = await track.sender?.getStats().catch(() => undefined);
    if (!report) return undefined;

    for (const stats of report.values()) {
      if (stats.type === "media-source" && stats.kind === "audio") {
        return typeof stats.audioLevel === "number"
          ? stats.audioLevel
          : undefined;
      }
    }
  }

  return undefined;
}

type Detector = {
  speaking: Accessor<boolean | undefined>;
  users: number;
  stop: () => void;
};

/**
 * One detector per participant, shared by every place showing it
 */
const detectors = new WeakMap<Participant, Detector>();

/**
 * Start polling a participant's level
 * @param participant Participant
 * @returns Detector
 */
function createDetector(participant: Participant): Detector {
  const [speaking, setSpeaking] = createSignal<boolean>();
  const analysers: { current?: TrackAnalyser } = {};

  let reading = false;
  let loudPolls = 0;
  let lastLoud = 0;

  const poll = async () => {
    // getStats can take longer than a poll
    if (reading) return;
    reading = true;

    try {
      const level = await readLevel(participant, analysers);
      if (level === undefined) {
        loudPolls = 0;
        setSpeaking(undefined);
        return;
      }

      const now = Date.now();
      if (level >= SPEAKING_LEVEL) {
        loudPolls++;
        if (loudPolls >= START_POLLS) lastLoud = now;
      } else {
        loudPolls = 0;
      }

      setSpeaking(now - lastLoud < HOLD_MS);
    } finally {
      reading = false;
    }
  };

  const timer = setInterval(poll, POLL_MS);

  return {
    speaking,
    users: 0,
    stop: () => {
      clearInterval(timer);
      clearAnalyser(analysers);
    },
  };
}

/**
 * Whether a participant is speaking, reacting much faster than the server's
 * speaking state
 * @param participant Participant
 * @returns Whether they're speaking
 */
export function useFastIsSpeaking(participant: Participant): Accessor<boolean> {
  const server = useIsSpeaking(participant);

  let detector = detectors.get(participant);
  if (!detector) {
    detector = createDetector(participant);
    detectors.set(participant, detector);
  }

  const current = detector;
  current.users++;

  onCleanup(() => {
    current.users--;
    if (current.users === 0) {
      current.stop();
      detectors.delete(participant);
    }
  });

  return () => current.speaking() ?? server();
}
