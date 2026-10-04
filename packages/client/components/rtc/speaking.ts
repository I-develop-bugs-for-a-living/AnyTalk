import { Accessor, createSignal, onCleanup } from "solid-js";
import { useIsSpeaking } from "solid-livekit-components";

import { LocalTrack, Participant, RemoteTrack, Track } from "livekit-client";

/**
 * Speaking detection from audio levels in the client
 *
 * LiveKit's own speaking state comes from the server, which only sends
 * updates every few hundred ms after smoothing them, so the indicator showed
 * up around a second after someone started talking. Instead we read the
 * level of each microphone track directly: from the RTP audio level header
 * for remote tracks and from the sender's stats for our own track.
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
 * Read the current microphone level of a participant
 * @param participant Participant
 * @returns Level from 0 to 1, or undefined if it can't be read
 */
async function readLevel(
  participant: Participant,
): Promise<number | undefined> {
  const publication = participant.getTrackPublication(Track.Source.Microphone);
  const track = publication?.track;
  if (!publication || publication.isMuted) return 0;
  if (!track) return undefined;

  if (track instanceof RemoteTrack) {
    const sources = track.receiver?.getSynchronizationSources?.();
    if (!sources) return undefined;

    const now = performance.timeOrigin + performance.now();
    let level = 0;
    for (const source of sources) {
      if (now - source.timestamp > STALE_MS) continue;
      level = Math.max(level, source.audioLevel ?? 0);
    }
    return level;
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

  let reading = false;
  let loudPolls = 0;
  let lastLoud = 0;

  const poll = async () => {
    // getStats can take longer than a poll
    if (reading) return;
    reading = true;

    try {
      const level = await readLevel(participant);
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
    stop: () => clearInterval(timer),
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
