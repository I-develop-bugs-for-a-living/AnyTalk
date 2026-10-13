import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  Setter,
  useContext,
} from "solid-js";
import {
  RoomContext,
  TrackReferenceOrPlaceholder,
  useTracks,
} from "solid-livekit-components";

import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import {
  AudioCaptureOptions,
  AudioPresets,
  LocalAudioTrack,
  LocalTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  ScreenShareCaptureOptions,
  ScreenSharePresets,
  Track,
  TrackEvent,
  TrackPublishOptions,
  VideoEncoding,
  VideoPresets,
} from "livekit-client";
import { Channel } from "stoat.js";

import { SoundController, useSound } from "@revolt/client";
import { useInstance } from "@revolt/instance";
import { ModalController, useModals } from "@revolt/modal";
import { useState } from "@revolt/state";
import {
  closestScreenShareResolution,
  NoiseSuppresionState,
  ScreenShareFrameRate,
  ScreenShareFrameRates,
  ScreenShareResolution,
  ScreenShareResolutions,
  Voice as VoiceSettings,
} from "@revolt/state/stores/Voice";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { Device, useDevice } from "@revolt/common";
import { CallSounds } from "./components/CallSounds";
import { InRoom } from "./components/InRoom";
import { RoomAudioManager } from "./components/RoomAudioManager";
import { StatsRecorder } from "./components/StatsRecorder";
import { StreamViewers } from "./components/StreamViewers";
import { VoiceKeybinds } from "./components/VoiceKeybinds";
import { VoiceMoves } from "./components/VoiceMoves";
import {
  type FrameSample,
  type RefreshState,
  countMissed,
  FOLLOW_GRACE_MAX_MS,
  FOLLOW_GRACE_RECHECK_MS,
  followDecision,
  graceWaitMs,
  graceWindow,
  isFlowing,
  isStalled,
  STALL_POLL_MS,
  swapDelayMs,
  windowListed,
} from "./gameFollow";
import * as outputBus from "./outputBus";
import {
  allowMicRestart,
  isPermanentJoinError,
  rejoinDelayMs,
  sdkRetryDelayMs,
  shouldKeepRejoining,
  shouldRejoin,
} from "./reconnect";
import { fetchRunningGames, subscribeRunningGames } from "./runningGames";
import {
  setScreenCaptureKeepFocus,
  setScreenCaptureLimit,
} from "./screenCapture";
import { VoiceProcessor } from "./VoiceProcessor";

type State =
  | "READY"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";

export type VoiceLayout = "fullscreen" | "expanded" | "collapsed" | undefined;

/** Fixed screen share sizes; "source" uses the shared surface's own size */
const SCREEN_SHARE_SIZES: Record<
  Exclude<ScreenShareResolution, "source">,
  [number, number]
> = {
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
};

/** Max bitrate at 30 fps, in bits per second */
const SCREEN_SHARE_BITRATES: Record<ScreenShareResolution, number> = {
  "720p": 2_500_000,
  "1080p": 5_000_000,
  "1440p": 8_000_000,
  source: 10_000_000,
};

/** Bitrate multiplier relative to 30 fps */
const FRAME_RATE_BITRATE_FACTOR: Record<ScreenShareFrameRate, number> = {
  5: 0.3,
  15: 0.6,
  30: 1,
  60: 1.6,
};

export const SCREEN_SHARE_RESOLUTION_LABELS: Record<
  ScreenShareResolution,
  string
> = {
  "720p": "720p",
  "1080p": "1080p",
  "1440p": "1440p",
  source: "Source",
};

type ScreenShareQuality = Required<
  Pick<ScreenShareCaptureOptions, "contentHint" | "resolution">
> & {
  encoding: VideoEncoding;
};

/** What our stream is set to while streaming */
export type StreamOptions = {
  resolution: ScreenShareResolution;
  frameRate: ScreenShareFrameRate;
  audio: boolean;
};

/** A screen share that is being started, not published yet */
type ScreenCapture = {
  /** What the browser captured, empty until the picker is done */
  tracks: LocalTrack[];
  /** The settings dialog, while it is shown */
  modalId?: string;
  /** Set once the tracks go out, they then can't just be stopped */
  publishing: boolean;
};

/** Stream audio is captured as is, without the processing meant for voices */
const STREAM_AUDIO_CAPTURE: AudioCaptureOptions = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
  voiceIsolation: false,
  restrictOwnAudio: true,
};

/**
 * Stream audio is music and video sound rather than speech: send it in
 * stereo at a music bitrate, and keep sending it through silence (DTX nearly
 * stops sending while it's quiet)
 */
const STREAM_AUDIO_PUBLISH_OPTIONS: TrackPublishOptions = {
  audioPreset: AudioPresets.musicHighQualityStereo,
  forceStereo: true,
  dtx: false,
  red: false,
};

/**
 * How long join and leave sounds wait for a move event of the same person,
 * so a move only plays the moved sound
 */
const MOVE_GRACE_MS = 750;

/** How long to watch for the microphone going silent after an output switch */
const MIC_RECOVERY_WATCH_MS = 3000;

/** How long a system mute may last before the microphone is restarted */
const MIC_RECOVERY_SETTLE_MS = 1000;

/** How long one attempt to open a connection may take before the SDK gives up */
const PEER_CONNECTION_TIMEOUT_MS = 20_000;

/** How long one LiveKit node may take to answer the latency check */
const NODE_PING_TIMEOUT_MS = 3000;

/** A running attempt to get back into the call after the connection dropped */
type Rejoin = {
  /** Set once the user left or joined another call */
  cancelled: boolean;
  /** Wakes up whatever the attempt is waiting for, so it can stop */
  wake: Set<() => void>;
};

/**
 * How a screen capture ended: `cancelled` when the capture request was
 * dismissed (or the preselected source was gone), which is no error
 */
type CaptureResult = "done" | "cancelled" | "failed";

/** How long an unpublished stream may stay away before it counts as ended */
const STREAM_REPUBLISH_WAIT_MS = 4000;

/** How long a capture or a track swap may take before it counts as hung */
const SWAP_TIMEOUT_MS = 10_000;

/** A capture step took too long */
class CaptureTimeout extends Error {}

/**
 * Give a step a time limit, so a hang can't block the swap queue
 * @param promise The step
 * @param what Name of the step, for the error
 * @param onLate Cleans up the result when the step finishes after the limit
 */
function withTimeout<T>(
  promise: Promise<T>,
  what: string,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new CaptureTimeout(`${what} timed out`));
    }, SWAP_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) onLate?.(value);
        else resolve(value);
      },
      (e) => {
        clearTimeout(timer);
        if (!timedOut) reject(e);
      },
    );
  });
}

/**
 * Whether an error is the browser's way of saying the capture was dismissed
 */
function isCaptureCancelled(e: unknown) {
  return (
    e instanceof DOMException &&
    (e.name === "NotAllowedError" || e.name === "AbortError")
  );
}

/**
 * Log why a capture or swap step did not work, for finding out why automatic
 * swaps fail (e.g. no user activation for getDisplayMedia)
 * @param step Which step failed
 * @param e The error
 */
function logCaptureFailure(step: string, e: unknown) {
  const err = e as Error | undefined;
  console.debug("[follow] failed at", step, err?.name, err?.message);
}

/** A stream that follows a game, see Voice.startGameStream */
type Follow = {
  gameId: string;
  sourceId: string;
  stop: () => void;
  /** Updates in a row that lacked the game, one may be a failed scan */
  missed: number;
  /** The window the stream stalled on, read by the next sync */
  stalledOn?: string;
  /** The captured track ended and the wait for a new window is going on */
  grace?: boolean;
  /** Recaptures of the captured window after it stalled */
  refresh?: RefreshState;
  /** Ends the wait for a window after the capture ended, if one is going on */
  wake?: () => void;
};

class Voice {
  /** Why the last window replacement failed, for the follow log */
  #swapFailure?: string;

  #settings: VoiceSettings;

  /** When people last moved into or out of our channel, by user id */
  #movedAt = new Map<string, number>();

  channel: Accessor<Channel | undefined>;
  #setChannel: Setter<Channel | undefined>;

  room: Accessor<Room | undefined>;
  #setRoom: Setter<Room | undefined>;

  vidTracks: Accessor<TrackReferenceOrPlaceholder[]>;

  state: Accessor<State>;
  #setState: Setter<State>;

  deafen: Accessor<boolean>;
  microphone: Accessor<boolean>;

  video: Accessor<boolean>;
  #setVideo: Setter<boolean>;

  screenshare: Accessor<boolean>;
  #setScreenshare: Setter<boolean>;

  /** What our stream is set to, once it is set up */
  streamOptions: Accessor<StreamOptions | undefined>;
  #setStreamOptions: Setter<StreamOptions | undefined>;

  /**
   * Captured stream audio, kept while it isn't sent so it can be turned back
   * on without capturing again
   */
  #streamAudio?: LocalAudioTrack;

  /** Game id our stream follows, for the game section of the call footer */
  followedGameId: Accessor<string | undefined>;
  #setFollowedGameId: Setter<string | undefined>;

  /**
   * Follow mode: the game whose window our stream shows, with the window
   * captured now, and the stop function of its running games listener
   */
  #follow?: Follow;

  /**
   * Identifies the running screen share across window swaps (a swap
   * publishes a new track), undefined when nothing is shared
   */
  #shareToken?: object;

  /** Counts published screen share tracks, a swap makes it go up */
  #trackGen = 0;

  /** The screen share video track that is published now */
  #currentVideo?: LocalVideoTrack;

  /**
   * People whose stream was unpublished a moment ago: a window swap
   * republishes it, which must not look like the stream ended
   */
  #pendingEnds = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; sound: boolean }
  >();

  /** Polls the stream's frame counter while following, see #watchStall */
  #stallTimer?: ReturnType<typeof setInterval>;

  /** Latest running games reported while following */
  #followGames: RunningGame[] = [];

  /** Window swaps run one after the other, this is the end of the queue */
  #swapQueue: Promise<unknown> = Promise.resolve();

  /** Stream audio is held back while the stream is being set up */
  #holdStreamAudio = false;

  layout: Accessor<VoiceLayout>;
  #setLayout: Setter<VoiceLayout>;

  focusId: Accessor<string | undefined>;
  #setFocus: Setter<string | undefined>;

  showBar: Accessor<boolean>;
  #setShowBar: Setter<boolean>;

  /**
   * The browser won't play call audio until the user interacts with the
   * page (iOS Safari), our microphone isn't processed meanwhile either
   */
  audioBlocked: Accessor<boolean>;
  #setPlaybackBlocked: Setter<boolean>;
  #setMicBlocked: Setter<boolean>;
  #releaseAudioUnlock?: () => void;

  /**
   * Participants whose screen share we chose to watch; other streams are
   * not subscribed to, so they cost no bandwidth until someone opens them
   */
  watching = new ReactiveSet<string>();

  /**
   * Streams the other participants told us they watch, by viewer (see
   * StreamViewers)
   */
  viewing = new ReactiveMap<string, string[]>();

  /**
   * Counts how often the connection came back, so state that other
   * participants may have lost (see StreamViewers) is sent again
   */
  resyncs: Accessor<number>;
  #setResyncs: Setter<number>;

  /** Participant whose stream should be focused once its tile shows up */
  pendingFocus: Accessor<string | undefined>;
  #setPendingFocus: Setter<string | undefined>;

  private sound: SoundController;
  private device: Device;

  private openModal;
  #closeModal: (id: string) => void;
  private config;
  private limits;
  private screenShareTracks: Set<string>;
  private voiceProcessor?: VoiceProcessor;

  constructor(
    voiceSettings: VoiceSettings,
    modals: ModalController,
    sound: SoundController,
    device: Device,
  ) {
    this.#settings = voiceSettings;
    this.sound = sound;
    this.device = device;

    const [channel, setChannel] = createSignal<Channel>();
    this.channel = channel;
    this.#setChannel = setChannel;

    const [room, setRoom] = createSignal<Room>();
    this.room = room;
    this.#setRoom = setRoom;

    this.vidTracks = () => [];

    const [state, setState] = createSignal<State>("READY");
    this.state = state;
    this.#setState = setState;

    this.deafen = () => voiceSettings.deafen;
    this.microphone = () => voiceSettings.micOn && !voiceSettings.deafen;

    const [video, setVideo] = createSignal(false);
    this.video = video;
    this.#setVideo = setVideo;

    const [screenshare, setScreenshare] = createSignal(false);
    this.screenshare = screenshare;
    this.#setScreenshare = setScreenshare;

    const [streamOptions, setStreamOptions] = createSignal<StreamOptions>();
    this.streamOptions = streamOptions;
    this.#setStreamOptions = setStreamOptions;

    const [followedGameId, setFollowedGameId] = createSignal<string>();
    this.followedGameId = followedGameId;
    this.#setFollowedGameId = setFollowedGameId;

    const [layout, setLayout] = createSignal<VoiceLayout>();
    this.layout = layout;
    this.#setLayout = setLayout;

    const [focus, setFocus] = createSignal<string>();
    this.focusId = focus;
    this.#setFocus = setFocus;

    const [showBar, setShowBar] = createSignal(true);
    this.showBar = showBar;
    this.#setShowBar = setShowBar;

    const [playbackBlocked, setPlaybackBlocked] = createSignal(false);
    const [micBlocked, setMicBlocked] = createSignal(false);
    this.audioBlocked = () => playbackBlocked() || micBlocked();
    this.#setPlaybackBlocked = setPlaybackBlocked;
    this.#setMicBlocked = setMicBlocked;

    const [resyncs, setResyncs] = createSignal(0);
    this.resyncs = resyncs;
    this.#setResyncs = setResyncs;

    const [pendingFocus, setPendingFocus] = createSignal<string>();
    this.pendingFocus = pendingFocus;
    this.#setPendingFocus = setPendingFocus;

    const inst = useInstance();
    this.config = inst.config;
    this.limits = inst.limits;
    this.openModal = modals.openModal;
    this.#closeModal = modals.remove;

    this.screenShareTracks = new Set();

    // Setup settings listeners
    this.settingsListeners();
  }

  // Dynamically set echo cancellation and gain control when the settings are changed
  // These functions are needed to maintain reactivity. Don't ask me why but if you make them not functions it breaks.
  private settingsListeners() {
    const getSettings = () => this.#settings;

    const setEchoCancellation = (echoCancellation: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.echoCancellation = echoCancellation;
      }
    };

    const setAutoGainControl = (autoGainControl: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.autoGainControl = autoGainControl;
      }
    };

    const setNoiseSuppression = (noiseSuppression: NoiseSuppresionState) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        if (noiseSuppression === "browser") {
          track.constraints.noiseSuppression = true;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = true;
        } else {
          track.constraints.noiseSuppression = false;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = false;
        }
      }
    };

    const restartTrack = () => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.restartTrack();
      }
    };

    createEffect(() => {
      setEchoCancellation(getSettings().echoCancellation ?? true);
      setAutoGainControl(getSettings().autoGainControl ?? true);
      setNoiseSuppression(getSettings().noiseSupression ?? "browser");
      restartTrack();
    });
  }

  async connect(channel: Channel, auth?: { url: string; token: string }) {
    this.#cancelRejoin();
    return this.#open(channel, auth, false);
  }

  /**
   * Open the room of a channel
   * @param channel Channel
   * @param auth Token and url, fetched when left out
   * @param rejoining Whether this is an attempt to get back into the call
   * after the connection dropped, which keeps the call's screen in place
   */
  async #open(
    channel: Channel,
    auth: { url: string; token: string } | undefined,
    rejoining: boolean,
  ) {
    const rejoin = rejoining ? this.#rejoin : undefined;
    if (!rejoining) this.#micRestarts = [];
    this.#teardown(rejoining);

    // Safari: start the audio output bus while still inside the tap that
    // joined the call (before the first await), it needs a gesture
    if (outputBus.isBusMode()) {
      outputBus.prime(this.#settings.preferredAudioOutputDevice);
    }

    this.device.setWakeLocked();

    const room = new Room({
      // Only receive video at the size it is displayed, and pause it when hidden
      adaptiveStream: true,
      // Stop sending simulcast layers that nobody is subscribed to
      dynacast: true,
      // Keep trying for about a minute, so a switch from wifi to mobile or a
      // phone waking up recovers inside the SDK before we have to rejoin
      reconnectPolicy: {
        nextRetryDelayInMs: (context) => sdkRetryDelayMs(context),
      },
      audioCaptureDefaults: {
        deviceId: this.#settings.preferredAudioInputDevice,
        echoCancellation: this.#settings.echoCancellation,
        noiseSuppression: this.#settings.noiseSupression === "browser",
        autoGainControl: this.#settings.autoGainControl,
        voiceIsolation: this.#settings.noiseSupression === "browser",
      },
      audioOutput: {
        deviceId: this.#settings.preferredAudioOutputDevice,
      },
      videoCaptureDefaults: {
        // TODO: Support higher resolutions based on limits
        resolution: VideoPresets.h720.resolution,
        deviceId: this.#settings.preferredVideoDevice,
      },
      publishDefaults: {
        videoEncoding: VideoPresets.h720.encoding,
        screenShareEncoding: ScreenSharePresets.h720fps30.encoding,
      },
    });

    this.#unlockAudio(room);

    const tracks = useTracks(
      [
        { source: Track.Source.Camera, withPlaceholder: true },
        { source: Track.Source.ScreenShare, withPlaceholder: false },
      ],
      { room, onlySubscribed: false },
    );

    // One tile per person: while someone streams, the stream replaces their
    // own tile
    this.vidTracks = createMemo(() => {
      const all = tracks();
      const streaming = new Set(
        all
          .filter((t) => t.source === Track.Source.ScreenShare)
          .map((t) => t.participant.identity),
      );
      return all.filter(
        (t) =>
          t.source === Track.Source.ScreenShare ||
          !streaming.has(t.participant.identity),
      );
    });

    batch(() => {
      this.#setRoom(room);
      this.#setChannel(channel);
      this.#setState(rejoining ? "RECONNECTING" : "CONNECTING");
      this.#setVideo(false);
      this.#setScreenshare(false);
    });

    // Whether we got into the call, a failed attempt isn't worth rejoining
    let joined = false;

    room.addListener("connected", () => {
      joined = true;
      this.#setState("CONNECTED");
      this.#settings.addRecentCall(channel.id);
      if (this.speakingPermission)
        // the microphone state the user had (muted or not) is in the settings
        room.localParticipant
          .setMicrophoneEnabled(this.#settings.micOn)
          .then((track) => {
            this.#settings.micOn = track != null;
          })
          // MediaDevicesError tells what went wrong
          .catch((err) => console.warn("[rtc] could not start the mic", err));
      if (rejoining) {
        // streams of people who left meanwhile can't be watched any more
        for (const id of [...this.watching]) {
          if (
            id !== room.localParticipant.identity &&
            !room.remoteParticipants.has(id)
          ) {
            this.#unwatch(id);
          }
        }
      }
      for (const p of room.remoteParticipants.values()) {
        const screenShareTrack = p.getTrackPublication(
          Track.Source.ScreenShare,
        );
        if (screenShareTrack) {
          this.screenShareTracks.add(screenShareTrack.trackSid);
        }
      }
      this.sound.playSound("userJoinVoice");
      this.#shareDeafen(room);
    });

    room.addListener("disconnected", (reason) => {
      // a rejoin that is going on handles its own failures, except being
      // sent away from the new room (e.g. joined on another device)
      if (this.#rejoin) {
        if (!shouldRejoin(reason)) {
          this.#cancelRejoin();
          this.#setState("DISCONNECTED");
        }
        return;
      }

      if (joined && shouldRejoin(reason)) {
        this.#startRejoin(channel);
      } else {
        this.#setState("DISCONNECTED");
      }
    });

    room.addListener("reconnecting", () => this.#setState("RECONNECTING"));
    room.addListener("signalReconnecting", () =>
      this.#setState("RECONNECTING"),
    );
    room.addListener("reconnected", () => {
      this.#setState("CONNECTED");
      // a full reconnect forgets what we told the others
      this.#shareDeafen(room);
      this.#setResyncs((n) => n + 1);
    });

    room.addListener("mediaDevicesError", (error, kind) =>
      this.#onMediaDevicesError(room, error, kind),
    );

    room.addListener("localTrackPublished", (pub) => {
      const mic = pub.audioTrack;
      // only watch the track of the room we are in, not one of a dead room
      const watch = () => {
        if (
          this.room() === room &&
          this.getMicrophoneTrack()?.audioTrack === mic
        ) {
          this.#watchMicrophone(mic!);
        }
      };
      if (mic && mic.source === Track.Source.Microphone) {
        if (!mic.getProcessor()) {
          mic
            .setProcessor(
              (this.voiceProcessor = new VoiceProcessor(
                this.#settings,
                this.#setMicBlocked,
              )),
            )
            // without it the unprocessed microphone is sent, which still works
            .catch((err) =>
              console.error("[rtc] could not set up voice processing", err),
            )
            // the track to watch may have changed
            .finally(watch);
        }
        watch();
      }
    });

    room.addListener("participantConnected", (participant) => {
      this.#announce(room, participant.identity, "userJoinVoice");
    });

    room.addListener("participantDisconnected", (participant) => {
      this.#announce(room, participant.identity, "userLeaveVoice");
      this.#unwatch(participant.identity);
    });

    room.addListener("trackPublished", (pub, participant) => {
      // streams aren't watched automatically, so announce them right away
      if (pub.source === Track.Source.ScreenShare) {
        // back after a window swap: not a new stream
        if (!this.#cancelPendingEnd(participant.identity)) {
          this.sound.playSound("streamStart");
        }
        this.screenShareTracks.add(pub.trackSid);
      }
    });

    room.addListener("localTrackPublished", (pub) => {
      // back after a window swap: our own view stays
      if (pub.source === Track.Source.ScreenShare) {
        this.#cancelPendingEnd(room.localParticipant.identity);
      }
    });

    room.addListener("localTrackUnpublished", (unpub) => {
      if (unpub.source === Track.Source.ScreenShare) {
        this.#deferStreamEnd(room.localParticipant.identity);
      }
    });

    room.addListener("trackUnpublished", (unpub, participant) => {
      const known = this.screenShareTracks.delete(unpub.trackSid);
      if (unpub.source === Track.Source.ScreenShare) {
        this.#deferStreamEnd(participant.identity, known);
      }
    });

    // Gather latency, a slow or unreachable node must not block the join
    const nodes = this.config.features.livekit.nodes;
    const selected = await Promise.any(
      nodes.map(async (node) => {
        return fetch(node.public_url.replace("wss", "https"), {
          signal: AbortSignal.timeout(NODE_PING_TIMEOUT_MS),
        }).then(() => {
          return node.name;
        });
      }),
    ).catch(() => nodes[0]?.name);

    // left or joined elsewhere while picking, don't ask for a token
    if (this.room() !== room || (rejoin && rejoin.cancelled)) {
      room.removeAllListeners();
      room.disconnect();
      return;
    }

    if (!auth) {
      auth = await channel.joinCall(selected);
    }

    // left or joined elsewhere while waiting
    if (this.room() !== room || (rejoin && rejoin.cancelled)) {
      room.removeAllListeners();
      room.disconnect();
      return;
    }

    await room.connect(auth.url, auth.token, {
      autoSubscribe: false,
      maxRetries: 3,
      peerConnectionTimeout: PEER_CONNECTION_TIMEOUT_MS,
    });
  }

  /** The attempt to get back into the call, while there is one */
  #rejoin?: Rejoin;

  /** Stop trying to get back into the call */
  #cancelRejoin() {
    const rejoin = this.#rejoin;
    this.#rejoin = undefined;
    if (!rejoin) return;
    rejoin.cancelled = true;
    rejoin.wake.forEach((wake) => wake());
  }

  /**
   * Wait for a while or until the attempt is cancelled
   * @param rejoin Attempt that waits
   * @param ms Milliseconds to wait
   */
  #rejoinSleep(rejoin: Rejoin, ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        rejoin.wake.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      rejoin.wake.add(done);
    });
  }

  /**
   * Wait for the browser to be online again, or until the attempt is
   * cancelled
   * @param rejoin Attempt that waits
   */
  #rejoinOnline(rejoin: Rejoin) {
    return new Promise<void>((resolve) => {
      const done = () => {
        window.removeEventListener("online", done);
        rejoin.wake.delete(done);
        resolve();
      };
      window.addEventListener("online", done);
      rejoin.wake.add(done);
    });
  }

  /**
   * The connection dropped for good: clean up the room and join the same
   * channel again with growing waits in between, through the normal join so
   * the token is fresh. Gives up after a while, and stops when the user
   * leaves or joins another call (see disconnect).
   * @param channel Channel of the call
   */
  #startRejoin(channel: Channel) {
    this.#cancelRejoin();
    const rejoin: Rejoin = { cancelled: false, wake: new Set() };
    this.#rejoin = rejoin;

    // Drop the dead room, the call's screen stays. Camera, screen share and
    // stream audio are not brought back on purpose: a screen share needs a
    // user gesture, so the user starts them again.
    this.#teardown(true);
    this.#setState("RECONNECTING");

    const run = async () => {
      let started = Date.now();
      let attempt = 0;

      while (!rejoin.cancelled && shouldKeepRejoining(Date.now() - started)) {
        // offline attempts would only fail: wait, and start counting anew
        if (!navigator.onLine) {
          await this.#rejoinOnline(rejoin);
          started = Date.now();
          attempt = 0;
          continue;
        }

        await this.#rejoinSleep(rejoin, rejoinDelayMs(attempt++));
        if (rejoin.cancelled) return;

        try {
          await this.#open(channel, undefined, true);
          if (rejoin.cancelled) return;
          if (this.state() === "CONNECTED") {
            this.#rejoin = undefined;
            return;
          }
        } catch (e) {
          if (rejoin.cancelled) return;
          console.warn("[rtc] could not rejoin the call", e);
          // no permission, channel gone: trying again won't help
          if (isPermanentJoinError(e)) {
            this.#teardown(true);
            this.#rejoin = undefined;
            this.#setState("DISCONNECTED");
            return;
          }
        }

        // this attempt left a room behind that never got in
        this.#teardown(true);
        this.#setState("RECONNECTING");
      }

      if (!rejoin.cancelled) {
        this.#rejoin = undefined;
        this.#setState("DISCONNECTED");
      }
    };

    run();
  }

  /**
   * Play the join or leave sound for someone, unless they moved between
   * channels (see noteMove)
   * @param room Room they joined or left
   * @param userId User id
   * @param sound Sound to play
   */
  #announce(
    room: Room,
    userId: string,
    sound: "userJoinVoice" | "userLeaveVoice",
  ) {
    setTimeout(() => {
      if (this.room() !== room) return;
      const moved = this.#movedAt.get(userId);
      if (moved !== undefined && Date.now() - moved < MOVE_GRACE_MS * 4) return;
      this.sound.playSound(sound);
    }, MOVE_GRACE_MS);
  }

  /**
   * Someone moved into or out of our channel: play the moved sound instead
   * of them joining or leaving
   * @param userId User id
   */
  noteMove(userId: string) {
    this.#movedAt.set(userId, Date.now());
    this.sound.playSound("userMoved");
  }

  /**
   * Start call audio playback, which iOS only allows from a user gesture.
   * Called first while still inside the tap that joined the call, then again
   * on each interaction for as long as the browser keeps audio blocked.
   * @param room Room
   */
  #unlockAudio(room: Room) {
    const start = () =>
      room
        .startAudio()
        .catch(() => {})
        .finally(() => this.#setPlaybackBlocked(!room.canPlaybackAudio));

    room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
      this.#setPlaybackBlocked(!room.canPlaybackAudio),
    );

    const onInteraction = () => {
      if (this.audioBlocked()) {
        start();
        this.voiceProcessor?.resume();
      }
    };

    const events = ["click", "touchend", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, onInteraction, true));
    this.#releaseAudioUnlock = () => {
      events.forEach((e) => window.removeEventListener(e, onInteraction, true));
      this.#setPlaybackBlocked(false);
      this.#setMicBlocked(false);
    };

    start();
  }

  /**
   * Choose where call audio plays. Must be called from within a user gesture
   * (e.g. a click handler) because Safari only lets pages switch the output
   * device then. On Safari the device is switched on the output bus; anywhere
   * else LiveKit does it.
   * @param deviceId Output device (undefined or "default" for the system default)
   */
  setAudioOutput(deviceId?: string) {
    const id = !deviceId || deviceId === "default" ? undefined : deviceId;
    this.#settings.preferredAudioOutputDevice = id;

    if (outputBus.isBusMode()) {
      if (this.room()) {
        // started synchronously, still inside the gesture
        outputBus.setOutput(id);
        this.#recoverMicrophone();
      }
      return;
    }

    this.room()
      ?.switchActiveDevice("audiooutput", id ?? "default")
      .catch((err) => console.error("[rtc] could not switch output", err));
  }

  /**
   * Choose the microphone. Call it from within a user gesture. Switches the
   * live microphone. On Safari the output is applied again in the same
   * gesture, because iOS may move the output route when the input changes,
   * and the microphone is then checked like after an output switch.
   * @param deviceId Input device (undefined or "default" for the system default)
   */
  setAudioInput(deviceId?: string) {
    const id = !deviceId || deviceId === "default" ? undefined : deviceId;
    this.#settings.preferredAudioInputDevice = id;

    const bus = outputBus.isBusMode() && !!this.room();
    // synchronously, still inside the gesture
    if (bus) outputBus.setOutput(this.#settings.preferredAudioOutputDevice);

    this.room()
      ?.switchActiveDevice("audioinput", id ?? "default")
      // check the microphone only once the track has been replaced
      .then(() => bus && this.#recoverMicrophone())
      .catch((err) => console.error("[rtc] could not switch microphone", err));
  }

  /**
   * Switching the output (to AirPods in particular) can leave the iPhone's
   * microphone silent until it is toggled. If we aren't muted and the
   * microphone track is muted by the system or ended, restart it. The track
   * is checked right away, and for a few seconds afterwards for the system
   * muting it.
   */
  #recoverMicrophone(limited = false) {
    this.#cancelMicRecovery();
    if (!this.#micShouldWork()) return;

    const local = this.getMicrophoneTrack()?.audioTrack;
    if (!local) return;

    // the captured track and, with voice processing, the processed one
    const tracks = new Set<MediaStreamTrack>([
      local.mediaStreamTrack,
      ...(local.mediaStream?.getAudioTracks() ?? []),
    ]);
    const broken = () =>
      [...tracks].some((t) => t.muted || t.readyState === "ended");

    const restart = () => {
      // the user may have muted or left meanwhile
      if (
        !this.#micShouldWork() ||
        this.getMicrophoneTrack()?.audioTrack !== local
      ) {
        return;
      }
      if (limited) {
        const restarts = allowMicRestart(this.#micRestarts, Date.now());
        if (!restarts) return;
        this.#micRestarts = restarts;
      }
      local.restartTrack().catch((err) => {
        console.error("[rtc] could not restart the microphone", err);
        // the chosen microphone may be gone (unplugged), use the default
        if (this.#settings.preferredAudioInputDevice) {
          this.room()
            ?.switchActiveDevice("audioinput", "default")
            .catch((e) =>
              console.error("[rtc] could not switch to the default mic", e),
            );
        }
      });
    };

    if (broken()) {
      restart();
      return;
    }

    // otherwise watch for the system muting it for a moment; a short mute
    // that ends on its own needs no restart
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onMute = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (broken()) restart();
      }, MIC_RECOVERY_SETTLE_MS);
    };
    const onUnmute = () => clearTimeout(settle);
    const timer = setTimeout(() => {
      // stop watching, a pending settle check still runs
      cancel();
    }, MIC_RECOVERY_WATCH_MS);
    const cancel = () => {
      clearTimeout(timer);
      tracks.forEach((t) => {
        t.removeEventListener("mute", onMute);
        t.removeEventListener("unmute", onUnmute);
      });
    };

    tracks.forEach((t) => {
      t.addEventListener("mute", onMute);
      t.addEventListener("unmute", onUnmute);
    });
    this.#cancelMicRecovery = () => {
      cancel();
      clearTimeout(settle);
    };
  }

  /** Whether our microphone is meant to be sending */
  #micShouldWork() {
    const local = this.getMicrophoneTrack()?.audioTrack;
    return (
      this.#settings.micOn &&
      !this.#settings.deafen &&
      !!local &&
      !local.isMuted
    );
  }

  /** Stop watching the microphone after an output switch */
  #cancelMicRecovery: () => void = () => {};

  /** When the microphone was restarted lately, to not restart in a loop */
  #micRestarts: number[] = [];

  /** Stop watching the microphone for ending or being muted by the system */
  #stopWatchingMic: () => void = () => {};

  /**
   * Restart the microphone when it ends or the system mutes it for good (USB
   * microphone unplugged, a phone call taking the microphone), as long as the
   * user wants to be heard. Restarts are limited to a few per half minute.
   *
   * This watches the microphone all call long. The timed watch in
   * #recoverMicrophone only follows an output switch for a few seconds, and
   * is what this calls to do the actual check and restart.
   * @param local Microphone track
   */
  #watchMicrophone(local: LocalAudioTrack) {
    this.#stopWatchingMic();

    let watched: MediaStreamTrack[] = [];
    let settle: ReturnType<typeof setTimeout> | undefined;

    const recover = () => {
      this.#recoverMicrophone(true);
    };
    // a short mute that ends on its own needs no restart
    const onMute = () => {
      clearTimeout(settle);
      settle = setTimeout(recover, MIC_RECOVERY_SETTLE_MS);
    };
    const onUnmute = () => clearTimeout(settle);
    const onEnded = () => {
      clearTimeout(settle);
      recover();
    };

    const detach = () =>
      watched.forEach((t) => {
        t.removeEventListener("mute", onMute);
        t.removeEventListener("unmute", onUnmute);
        t.removeEventListener("ended", onEnded);
      });
    // the track is replaced whenever the microphone restarts
    const attach = () => {
      detach();
      watched = [
        ...new Set([
          local.mediaStreamTrack,
          ...(local.mediaStream?.getAudioTracks() ?? []),
        ]),
      ];
      watched.forEach((t) => {
        t.addEventListener("mute", onMute);
        t.addEventListener("unmute", onUnmute);
        t.addEventListener("ended", onEnded);
      });
    };

    local.on(TrackEvent.Restarted, attach);
    attach();
    this.#stopWatchingMic = () => {
      clearTimeout(settle);
      detach();
      local.off(TrackEvent.Restarted, attach);
    };
  }

  /**
   * A device could not be opened. When the chosen microphone is gone (not
   * found), carry on with the default one instead of staying silent.
   * @param room Room
   * @param error What went wrong
   * @param kind Kind of device
   */
  #onMediaDevicesError(room: Room, error: Error, kind?: MediaDeviceKind) {
    console.warn("[rtc] device error", kind, error);
    if (
      kind !== "audioinput" ||
      !this.#settings.preferredAudioInputDevice ||
      !["NotFoundError", "OverconstrainedError"].includes(error.name)
    ) {
      return;
    }

    room
      .switchActiveDevice("audioinput", "default")
      .then(() => {
        if (this.room() !== room || !this.#settings.micOn) return;
        if (this.#settings.deafen || room.localParticipant.isMicrophoneEnabled)
          return;
        return room.localParticipant.setMicrophoneEnabled(true);
      })
      .catch((err) =>
        console.error("[rtc] could not fall back to the default mic", err),
      );
  }

  /**
   * Retry starting call audio, must be called from a user gesture
   */
  startAudio() {
    this.voiceProcessor?.resume();
    this.room()
      ?.startAudio()
      .catch(() => {})
      .finally(() => this.#setPlaybackBlocked(!this.room()?.canPlaybackAudio));
  }

  /** Leave the call (also stops any attempt to get back into it) */
  disconnect() {
    this.#cancelRejoin();
    this.#micRestarts = [];
    this.#teardown(false);
  }

  /**
   * Treat a stream as ended after a short wait. A window swap unpublishes
   * and publishes the stream again within a moment, and whoever watches it
   * (and has it focused) should stay on it.
   * @param identity Who streamed
   * @param sound Play the stream end sound when it really ended
   */
  #deferStreamEnd(identity: string, sound = false) {
    const previous = this.#pendingEnds.get(identity);
    if (previous) clearTimeout(previous.timer);
    const withSound = sound || !!previous?.sound;
    this.#pendingEnds.set(identity, {
      sound: withSound,
      timer: setTimeout(() => {
        this.#pendingEnds.delete(identity);
        if (withSound) this.sound.playSound("streamEnd");
        this.#unwatch(identity);
        this.settleAfterStreamGone();
      }, STREAM_REPUBLISH_WAIT_MS),
    });
  }

  /**
   * A stream came back before it counted as ended
   * @returns Whether it was waiting to end
   */
  #cancelPendingEnd(identity: string) {
    const pending = this.#pendingEnds.get(identity);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.#pendingEnds.delete(identity);
    return true;
  }

  /**
   * Clean up the room
   * @param forRejoin Keep the channel and what is watched, to get back into
   * the call; nothing is told to the user
   */
  #teardown(forRejoin: boolean) {
    this.#endFollow();
    this.#shareToken = undefined;
    this.#currentVideo = undefined;
    this.#pendingEnds.forEach((p) => clearTimeout(p.timer));
    this.#pendingEnds.clear();
    this.#cancelCapture();
    this.#cancelMicRecovery();
    this.#stopWatchingMic();
    outputBus.teardown();
    this.device.releaseWakeLock();
    this.#releaseAudioUnlock?.();
    this.#releaseAudioUnlock = undefined;
    try {
      const room = this.room();
      if (!room) return;

      room.removeAllListeners();
      room.disconnect();

      // not stopped by disconnecting while it isn't sent
      this.#streamAudio?.stop();
      this.#streamAudio = undefined;
      this.#setStreamOptions();

      this.screenShareTracks = new Set();
      this.viewing.clear();

      if (forRejoin) return;

      batch(() => {
        this.#setState("READY");
        this.#setRoom();
        this.#setChannel();
        this.#setLayout();
        this.vidTracks = () => [];
      });

      this.watching.clear();
      this.#setPendingFocus();

      this.sound.playSound("userLeaveVoice");
    } catch (e) {
      this.onErr(e);
    }
  }

  /**
   * Tell the others in the call whether we are deafened; LiveKit itself has
   * no notion of it since deafening only silences playback on this device
   */
  #shareDeafen(room: Room) {
    room.localParticipant
      .setAttributes({ deafened: String(this.#settings.deafen) })
      .catch((err) =>
        // the server's token may not allow participants to set attributes
        console.warn("Could not share deafen state", err),
      );
  }

  async toggleDeafen(fromMute?: boolean) {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        (this.#settings.micOn || !!fromMute) &&
          !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.deafen = !this.#settings.deafen;
      this.#shareDeafen(room);
      if (fromMute) {
        this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;
      }
      if (this.#settings.deafen) {
        this.sound.playSound("deafen");
      } else {
        this.sound.playSound("undeafen");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleMute() {
    if (this.#settings.deafen) {
      this.toggleDeafen(true);
      return;
    }
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;

      if (this.#settings.micOn) {
        this.sound.playSound("unmute");
      } else {
        this.sound.playSound("mute");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleCamera() {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setCameraEnabled(
        !room.localParticipant.isCameraEnabled,
      );

      this.#setVideo(room.localParticipant.isCameraEnabled);
    } catch (e) {
      this.onErr(e);
    }
  }

  /** Whether the server's video_resolution limit allows this size (0 = unlimited) */
  #fitsLimit(width: number, height: number) {
    const limit = this.limits().video_resolution;
    return (
      (limit[0] === 0 || limit[0] >= width) &&
      (limit[1] === 0 || limit[1] >= height)
    );
  }

  /**
   * Screen share resolutions the server allows. 720p is always allowed,
   * "source" needs at least 1080p.
   */
  getEnabledScreenShareResolutions(): ScreenShareResolution[] {
    return ScreenShareResolutions.filter((resolution) => {
      if (resolution === "720p") return true;
      const [width, height] =
        SCREEN_SHARE_SIZES[resolution === "source" ? "1080p" : resolution];
      return this.#fitsLimit(width, height);
    });
  }

  /**
   * Capture constraints and encoding for a resolution and frame rate
   *
   * @param track Captured track, used to find the native size for "source"
   */
  #screenShareQuality(
    wanted: ScreenShareResolution,
    frameRate: ScreenShareFrameRate,
    track?: MediaStreamTrack,
  ): ScreenShareQuality {
    const resolution = closestScreenShareResolution(
      wanted,
      this.getEnabledScreenShareResolutions(),
    );
    let width: number, height: number;

    if (resolution === "source") {
      // Native size of the shared surface, scaled down to the server limit
      const capabilities = track?.getCapabilities?.();
      const limit = this.limits().video_resolution;
      width = capabilities?.width?.max ?? 0;
      height = capabilities?.height?.max ?? 0;

      if (!width || !height) {
        [width, height] = [limit[0] || 1920, limit[1] || 1080];
      }

      const scale = Math.min(
        1,
        limit[0] ? limit[0] / width : 1,
        limit[1] ? limit[1] / height : 1,
      );
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    } else {
      [width, height] = SCREEN_SHARE_SIZES[resolution];
    }

    return {
      resolution: { width, height, frameRate },
      encoding: {
        maxBitrate: Math.round(
          SCREEN_SHARE_BITRATES[resolution] *
            FRAME_RATE_BITRATE_FACTOR[frameRate],
        ),
        maxFramerate: frameRate,
      },
      contentHint:
        frameRate <= 5 ? "text" : frameRate <= 15 ? "detail" : "motion",
    };
  }

  /** Resolutions the server allows, for the screen share pickers */
  #resolutionOptions() {
    return this.getEnabledScreenShareResolutions().map((value) => ({
      value,
      label: SCREEN_SHARE_RESOLUTION_LABELS[value],
    }));
  }

  /**
   * Let the next screen capture open at the best quality we may ask for, so
   * changing quality never has to restart it
   */
  #prepareCapture() {
    let [width, height] = SCREEN_SHARE_SIZES["720p"];
    for (const resolution of this.getEnabledScreenShareResolutions()) {
      const [w, h] =
        resolution === "source"
          ? // without a server limit, up to 4K
            this.limits().video_resolution.map((n, i) => n || [3840, 2160][i])
          : SCREEN_SHARE_SIZES[resolution];
      width = Math.max(width, w);
      height = Math.max(height, h);
    }

    setScreenCaptureLimit({
      width,
      height,
      frameRate: Math.max(...ScreenShareFrameRates),
    });
  }

  /**
   * Show our own picker once the desktop app asks which screen to capture
   *
   * @returns The choice made in it, once made. Its `dismissed()` tells
   * whether the user cancelled the picker without a choice, in which case
   * the capture request fails on purpose and the failure is not an error.
   */
  #registerScreenPicker(skip = false) {
    let picked: StreamOptions | undefined;
    let cancelled = false;

    // with a preselected source the desktop app answers by itself
    if (!skip && window.native && window.native.onceScreenPicker) {
      window.native.onceScreenPicker((sources) => {
        this.openModal({
          type: "screen_share_picker",
          onCancel: () => {
            cancelled = true;
            window.native.screenPickerCallback?.(-1, false);
          },
          callback: (idx, resolution, frameRate, audio) => {
            window.native.screenPickerCallback?.(idx, audio);
            picked = { resolution, frameRate, audio };
          },
          sources: sources,
          resolutions: this.#resolutionOptions(),
        });
      });
    }

    return Object.assign(() => picked, {
      dismissed: () => cancelled && !picked,
    });
  }

  /** Whether the captured stream audio is currently sent */
  #streamAudioShared(room: Room) {
    const audio = this.#streamAudio;
    return (
      !!audio &&
      room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
        ?.track === audio
    );
  }

  /**
   * Keep captured stream audio, so it can be turned on and off while streaming
   */
  #keepStreamAudio(audio: LocalAudioTrack | undefined) {
    this.#streamAudio = audio;

    // During quiet parts the browser can report the captured audio as
    // muted, LiveKit then stops sending it until the capture reports
    // sound again, which might never happen. Only we pause stream audio.
    audio?.on(TrackEvent.UpstreamPaused, () => {
      if (!this.#holdStreamAudio) audio.resumeUpstream();
    });
  }

  /** Start or stop sending the captured stream audio */
  async #shareStreamAudio(room: Room, share: boolean) {
    const audio = this.#streamAudio;
    if (!audio || share === this.#streamAudioShared(room)) return;

    if (share) {
      await room.localParticipant.publishTrack(audio, {
        ...STREAM_AUDIO_PUBLISH_OPTIONS,
        source: Track.Source.ScreenShareAudio,
      });
      // it may have been held back while the stream was being set up
      if (!this.#holdStreamAudio) await audio.resumeUpstream();
    } else {
      // keep capturing, so it can be turned back on
      await room.localParticipant.unpublishTrack(audio, false);
    }
  }

  /** Apply a resolution, frame rate and audio choice to our stream */
  async #applyStreamOptions(room: Room, options: StreamOptions) {
    const video = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShare,
    )?.videoTrack;
    if (!video) return;

    const quality = this.#screenShareQuality(
      options.resolution,
      options.frameRate,
      video.mediaStreamTrack,
    );

    await video.applyScreenShareConstraints(
      {
        resolution: {
          frameRate: quality.resolution.frameRate,
          width: quality.resolution.width,
          height: quality.resolution.height,
        },
        contentHint: quality.contentHint,
      },
      quality.encoding,
    );
    await this.#shareStreamAudio(room, options.audio);

    this.#setStreamOptions(options);
  }

  async #stopScreenshare(room: Room) {
    const audio = this.#streamAudio;
    this.#endFollow();
    this.#shareToken = undefined;
    this.#currentVideo = undefined;

    await room.localParticipant.setScreenShareEnabled(false);

    // the stream may have ended on its own, which leaves the audio behind
    if (audio) {
      if (this.#streamAudioShared(room)) {
        await room.localParticipant.unpublishTrack(audio);
      }
      audio.stop();
    }

    if (this.#streamAudio === audio) this.#streamAudio = undefined;
    this.#setStreamOptions();

    this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
  }

  async toggleScreenshare() {
    const room = this.room();
    if (!room) throw "invalid state";

    if (this.screenshare()) {
      await this.#stopScreenshare(room);

      this.sound.playSound("streamEnd");
    } else if (this.#capture) {
      // Toggled again while a start is going on. While the settings are
      // shown that calls the start off, otherwise it is not interrupted.
      if (!this.#capture.publishing && this.#capture.tracks.length) {
        this.#cancelCapture();
      }
    } else {
      await this.#startScreenshare(room, false);
    }
  }

  /**
   * Capture and publish a screen share
   * @param room The room to share in
   * @param preselected The capture source was chosen beforehand (a game
   * stream, see setNextScreenSource): the saved quality is used without
   * asking. If the desktop app can't use the source, the capture is cancelled.
   * @returns How the start ended
   */
  async #startScreenshare(
    room: Room,
    preselected: boolean,
  ): Promise<CaptureResult> {
    let result: CaptureResult = "done";
    const capture: ScreenCapture = { tracks: [], publishing: false };
    this.#capture = capture;

    const picked = this.#registerScreenPicker(preselected);
    this.#prepareCapture();
    const asking = !preselected && this.#settings.screenShareQualityAsk;

    try {
      const chosenQuality = this.#screenShareQuality(
        this.#settings.screenShareResolution,
        this.#settings.screenShareFrameRate,
      );

      // Capture only. Nothing is published, so nobody sees the stream,
      // until the settings are confirmed.
      //
      // Stay in this tab. The browser would otherwise jump to the captured
      // tab right after the picker, before the settings are confirmed, and
      // there is no way to switch to it later on.
      setScreenCaptureKeepFocus(true);
      let tracks: LocalTrack[];
      try {
        tracks = await room.localParticipant.createScreenTracks({
          resolution: chosenQuality?.resolution,
          audio: STREAM_AUDIO_CAPTURE,
        });
      } finally {
        setScreenCaptureKeepFocus(false);
        // the chosen source is used once, drop it if it wasn't
        if (preselected) window.native.setNextScreenSource?.(null);
      }
      capture.tracks = tracks;

      const video = tracks.find(
        (t): t is LocalVideoTrack => t.kind === Track.Kind.Video,
      )!;
      const audio = tracks.find(
        (t): t is LocalAudioTrack => t.kind === Track.Kind.Audio,
      );

      // gone while picking
      if (this.#capture !== capture || this.room() !== room) {
        this.#cancelCapture(capture);
        return "failed";
      }

      const pickedOptions = picked();
      if (pickedOptions) {
        capture.publishing = true;
        await this.#publishScreenshare(room, video, audio, pickedOptions);
      } else if (asking) {
        // the capture can end (stopped from the browser) while waiting
        video.mediaStreamTrack.addEventListener(
          "ended",
          () => {
            if (this.#capture === capture && !capture.publishing) {
              this.#cancelCapture(capture);
            }
          },
          { once: true },
        );

        capture.modalId = this.openModal({
          onCancel: () => this.#cancelCapture(capture),
          type: "screen_share_settings",
          previewStream: new MediaStream([video.mediaStreamTrack]),
          resolutions: this.#resolutionOptions(),
          audio: !!audio,
          callback: async (resolution, frameRate, shareAudio) => {
            // cancelled meanwhile, or we left the call
            if (this.#capture !== capture || this.room() !== room) {
              this.#cancelCapture(capture);
              return;
            }
            capture.publishing = true;
            try {
              await this.#publishScreenshare(room, video, audio, {
                resolution,
                frameRate,
                audio: shareAudio,
              });
            } catch (e) {
              await this.#abortScreenshare(room, tracks);
              this.onErr(e);
            } finally {
              if (this.#capture === capture) this.#capture = undefined;
            }
          },
        });
      } else {
        // Not asking: apply the saved choice, otherwise the capture stays
        // at the low startup constraints from getDisplayMedia
        capture.publishing = true;
        await this.#publishScreenshare(room, video, audio, {
          resolution: this.#settings.screenShareResolution,
          frameRate: this.#settings.screenShareFrameRate,
          audio: this.#settings.screenShareAudio,
        });
      }
    } catch (e) {
      this.#cancelCapture(capture);
      await this.#abortScreenshare(room, capture.tracks);
      // Cancelling the picker makes the capture request fail, which is
      // no error: stay silent
      logCaptureFailure("start", e);
      if (picked.dismissed() || (preselected && isCaptureCancelled(e))) {
        result = "cancelled";
      } else {
        result = "failed";
        this.onErr(e);
      }
    } finally {
      // with the settings shown the start goes on in their callback
      if (this.#capture === capture && capture.modalId === undefined) {
        this.#capture = undefined;
      }
    }
    return result;
  }

  /** The screen share that is being started, until it's published or off */
  #capture?: ScreenCapture;

  /**
   * Call off the screen share that is being started: close its settings and
   * stop the captured tracks that were never published
   */
  #cancelCapture(capture = this.#capture) {
    if (!capture) return;
    if (this.#capture === capture) this.#capture = undefined;
    if (capture.modalId !== undefined) this.#closeModal(capture.modalId);
    capture.modalId = undefined;
    if (!capture.publishing) capture.tracks.forEach((t) => t.stop());
  }

  /**
   * Undo a screen share that failed to start. When part of it was already
   * published, stopping the tracks isn't enough to take it down again.
   */
  async #abortScreenshare(room: Room, tracks: LocalTrack[]) {
    if (room.localParticipant.getTrackPublication(Track.Source.ScreenShare)) {
      try {
        await this.#stopScreenshare(room);
      } catch (e) {
        console.debug("Could not stop the failed screen share:", e);
      }
    }

    tracks.forEach((t) => t.stop());
    if (this.#streamAudio && tracks.includes(this.#streamAudio)) {
      this.#streamAudio = undefined;
    }
    this.#setStreamOptions();
    this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
  }

  /**
   * Publish a captured screen (and its audio) with the confirmed settings,
   * this is the moment other participants get to see the stream
   */
  async #publishScreenshare(
    room: Room,
    video: LocalVideoTrack,
    audio: LocalAudioTrack | undefined,
    options: StreamOptions,
    swap = false,
  ) {
    const quality = this.#screenShareQuality(
      options.resolution,
      options.frameRate,
    );

    this.#holdStreamAudio = false;
    this.#keepStreamAudio(audio);
    // a window swap keeps the share it belongs to; stopped meanwhile, the
    // new capture must not go live
    if (swap && !this.#shareToken) {
      video.stop();
      audio?.stop();
      return;
    }
    if (!swap) this.#shareToken = {};
    this.#currentVideo = video;
    const gen = ++this.#trackGen;

    // This event is only fired if the screen share is ended by closing the window being streamed.
    // This catches the ending and disables screen sharing on our side. If this weren't here,
    // livekit would still share stream audio after closing the window being streamed.
    // Listening before publishing, so an end during it isn't missed.
    let ended = false;
    video.on(TrackEvent.Ended, () => {
      // a track that was swapped out
      if (this.#currentVideo !== video) return;
      // Following a game: its window may be replaced by another one soon.
      // Note the browser's own "stop sharing" button ends the track the same
      // way, so it is treated like a window closing: the stream lingers for
      // up to the grace period before it stops.
      if (this.#follow) {
        console.debug("[follow] capture ended", this.#follow.gameId);
        this.#followGrace(room, gen);
        return;
      }
      console.debug("[follow] capture ended, not following any game");
      ended = true;
      if (this.screenshare()) this.toggleScreenshare();
    });

    await room.localParticipant.publishTrack(video, {
      screenShareEncoding: quality.encoding,
      // Send only the full-size stream: a half-size simulcast copy makes
      // shared text unreadable for viewers showing the stream small
      simulcast: false,
    });

    this.#setScreenshare(room.localParticipant.isScreenShareEnabled);

    if (ended) {
      await this.#stopScreenshare(room);
      return;
    }

    this.#logPublished(video);

    // also shares the audio when chosen
    await this.#applyStreamOptions(room, options);
    if (!swap) this.sound.playSound("streamStart");
  }

  /** Log what the published capture delivers, to find out why one is black */
  #logPublished(video: LocalVideoTrack) {
    const track = video.mediaStreamTrack;
    const { width, height, frameRate } = track.getSettings();
    console.debug("[follow] published", {
      readyState: track.readyState,
      muted: track.muted,
      width,
      height,
      frameRate,
    });
    // one log per event, and none once the track is swapped out
    const onMute = () => console.debug("[follow] track muted");
    const onUnmute = () => console.debug("[follow] track unmuted");
    track.addEventListener("mute", onMute, { once: true });
    track.addEventListener("unmute", onUnmute, { once: true });
    video.once(TrackEvent.Ended, () => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
    });

    setTimeout(async () => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      if (this.#currentVideo !== video) return;
      const report = await video.sender?.getStats().catch(() => undefined);
      if (!report) return;
      for (const stats of report.values()) {
        if (stats.type === "outbound-rtp" && stats.kind === "video") {
          console.debug("[follow] sending after 3 s", {
            framesSent: stats.framesSent,
            bytesSent: stats.bytesSent,
            qualityLimitationReason: stats.qualityLimitationReason,
          });
        }
      }
    }, 3000);
  }

  /**
   * Stream another screen or window. The stream itself keeps going, so
   * whoever watches it keeps watching. Picking it by hand ends follow mode.
   */
  async switchScreenshareSource() {
    this.#endFollow();
    await this.#swap(() => this.#replaceSource());
  }

  /**
   * Stream a detected game (desktop app). The game's best window is captured
   * without the picker and the saved quality is used without asking. The
   * stream then follows the game: when its best window changes, or the
   * captured window closes and another one shows up within a few seconds,
   * the stream moves over to it and viewers keep watching. Stopping the
   * stream or switching window by hand ends that.
   * @param gameId Id of the game, as reported by getRunningGames
   */
  async startGameStream(gameId: string) {
    const room = this.room();
    if (!room) return;
    if (this.#capture || !window.native?.setNextScreenSource) return;

    let best: RunningGameWindow | undefined;
    let result: CaptureResult = "failed";

    try {
      // A preselected window that is gone cancels the capture: look at the
      // games again and retry once with the new best window
      for (let attempt = 0; attempt < 2; attempt++) {
        // use what is running right now, the list shown may be a moment old
        const game = (await fetchRunningGames()).find((g) => g.id === gameId);
        if (!game) return;
        best = game.windows[0];

        const target = best;
        // Queued with the other swaps, the chosen source is set right before
        // capturing so no earlier swap can take or clear it. No window
        // (Wayland): null shows the normal picker or portal.
        result = await this.#swap(async () => {
          if (this.screenshare()) {
            // Already streaming: move that stream over. Follow mode stays
            // as it is until the swap worked, so a failed swap loses nothing.
            const swapped = await this.#replaceSource(target?.sourceId);
            if (swapped === "done" && target && this.room() === room) {
              this.#beginFollow(gameId, target.sourceId);
            }
            return swapped;
          }
          await window.native.setNextScreenSource?.(target?.sourceId ?? null);
          return this.#startScreenshare(room, !!target);
        });
        if (result !== "cancelled" || !best) break;
      }
    } catch (e) {
      this.onErr(e);
      return;
    } finally {
      // in case nothing took it
      window.native.setNextScreenSource?.(null);
    }

    if (!best || !this.screenshare() || this.room() !== room) return;

    // follow only when the window was chosen for the user, not picked by hand
    if (result === "done") {
      if (
        this.#follow?.gameId !== gameId ||
        this.#follow.sourceId !== best.sourceId
      ) {
        this.#beginFollow(gameId, best.sourceId);
      }
    } else if (this.#follow?.gameId !== gameId) {
      // The swap did not work and the old stream goes on, maybe black.
      // Follow the game anyway, the window may show up later. The captured
      // source is unknown, so any best window counts as a change.
      this.#beginFollow(gameId, "");
    }
  }

  /** Start following a game with the stream showing the given window */
  #beginFollow(gameId: string, sourceId: string) {
    this.#endFollow();

    // a slow first read must not overwrite a newer update
    let updated = false;
    const follow: Follow = {
      gameId,
      sourceId,
      missed: 0,
      stop: subscribeRunningGames((games) => {
        updated = true;
        this.#updateFollowGames(follow, games);
      }),
    };
    this.#follow = follow;
    this.#followGames = [];
    this.#setFollowedGameId(gameId);
    console.debug("[follow] begin", gameId, sourceId);
    this.#watchStall(follow);
    fetchRunningGames().then((games) => {
      if (this.#follow !== follow || updated) return;
      this.#updateFollowGames(follow, games);
    });
  }

  /**
   * Take a new list of running games while following and act on it. A list
   * without the game once may be a failed scan, so it is read again soon.
   */
  #updateFollowGames(follow: Follow, games: RunningGame[]) {
    if (this.#follow !== follow) return;
    this.#followGames = games;
    follow.missed = countMissed(games, follow.gameId, follow.missed);

    if (follow.missed === 1) {
      setTimeout(async () => {
        if (this.#follow !== follow || follow.missed !== 1) return;
        this.#updateFollowGames(follow, await fetchRunningGames());
      }, 2000);
    }
    this.#syncFollow();
  }

  /** Stop following a game, the stream itself is left alone */
  #endFollow() {
    if (this.#follow) console.debug("[follow] end", this.#follow.gameId);
    clearInterval(this.#stallTimer);
    this.#stallTimer = undefined;
    this.#follow?.wake?.();
    this.#follow?.stop();
    this.#follow = undefined;
    this.#followGames = [];
    this.#setFollowedGameId();
  }

  /**
   * Move the stream to the followed game's best window if it is another one
   * than the captured one. Swaps are queued and look at the newest list
   * when their turn comes, so quick changes end up with a single swap.
   */
  #syncFollow() {
    return this.#swap(async () => {
      const follow = this.#follow;
      if (!follow) return;
      // only honoured for the window it was seen on
      const stalled = follow.stalledOn === follow.sourceId;
      follow.stalledOn = undefined;
      if (!this.screenshare()) return;
      const decision = followDecision(this.#followGames, {
        ...follow,
        stalled,
        now: Date.now(),
      });
      console.debug(
        "[follow] sync",
        decision,
        "current",
        follow.sourceId,
        "windows",
        this.#followGames
          .find((g) => g.id === follow.gameId)
          ?.windows.map((w) => `${w.sourceId}/${w.role}`),
      );
      if (decision.type === "release") {
        // the game stopped, the stream goes on
        this.#endFollow();
      } else if (decision.type === "refresh") {
        const sourceId = follow.sourceId;
        const attempts =
          follow.refresh?.sourceId === sourceId
            ? follow.refresh.attempts + 1
            : 1;
        console.debug("[follow] refresh", sourceId, "attempt", attempts);
        const result = await this.#followSwap(follow, sourceId);

        // a window that was gone is no attempt: read the games again
        if (result === "cancelled" && this.#follow === follow) {
          this.#followGames = await fetchRunningGames();
          const again = followDecision(this.#followGames, follow);
          if (this.#follow === follow && again.type === "switch") {
            await this.#followSwap(follow, again.sourceId);
          }
        } else if (this.#follow === follow) {
          follow.refresh = { sourceId, attempts, lastAt: Date.now() };
        }
      } else if (decision.type === "switch") {
        // A game window that just appeared may still be on its loading
        // screen and capture as gray, so give it time first. The wait holds
        // the swap queue on purpose: a grace or release task queued behind
        // it runs only after, and then sees the newest games.
        const delay = swapDelayMs(this.#followGames, follow, decision.sourceId);
        if (delay > 0) {
          console.debug("[follow] delaying the swap to", decision.sourceId);
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (this.#follow !== follow || !this.screenshare()) return;
          // it must still be the best choice
          const later = followDecision(this.#followGames, follow);
          if (later.type !== "switch" || later.sourceId !== decision.sourceId) {
            return;
          }
        }
        const result = await this.#followSwap(follow, decision.sourceId);

        // the window was gone already: read the games again and retry once
        if (result === "cancelled" && this.#follow === follow) {
          this.#followGames = await fetchRunningGames();
          const again = followDecision(this.#followGames, follow);
          if (this.#follow === follow && again.type === "switch") {
            await this.#followSwap(follow, again.sourceId);
          }
        }
      }
    });
  }

  /**
   * While following, watch whether the stream still sends frames. A window
   * that gets hidden instead of closed keeps the capture running without
   * frames and never ends it, so look at the games again when it stalls.
   */
  #watchStall(follow: Follow) {
    clearInterval(this.#stallTimer);
    let samples: FrameSample[] = [];

    // a slow getStats must not pile up
    let inFlight = false;

    /** One reading of the frame counter */
    const check = async () => {
      const video = this.room()?.localParticipant.getTrackPublication(
        Track.Source.ScreenShare,
      )?.videoTrack;
      const report = await video?.sender?.getStats().catch(() => undefined);
      if (!report || this.#follow !== follow) return;
      // the track ended, so it would always look stalled
      if (follow.grace) return;

      let frames: number | undefined;
      for (const stats of report.values()) {
        if (stats.type === "outbound-rtp" && stats.kind === "video") {
          frames = stats.framesSent ?? stats.framesEncoded;
        }
      }
      if (typeof frames !== "number") return;

      samples = [...samples, { at: Date.now(), frames }].slice(-8);
      // a window that keeps sending frames recovered (a few frames then
      // standing still don't count)
      if (isFlowing(samples)) follow.refresh = undefined;
      if (!isStalled(samples)) return;

      // look again only after another full stall time
      samples = [];
      console.debug("[follow] no frames sent, checking the games");
      const games = await fetchRunningGames();
      // the decision recaptures the window when it is still the best one
      follow.stalledOn = follow.sourceId;
      this.#updateFollowGames(follow, games);
    };

    this.#stallTimer = setInterval(async () => {
      if (this.#follow !== follow || inFlight) return;
      inFlight = true;
      try {
        await check();
      } finally {
        inFlight = false;
      }
    }, STALL_POLL_MS);
  }

  /**
   * Capture a window of the followed game and move the stream to it
   * @returns `cancelled` when the window was gone, the stream is left as is
   */
  async #followSwap(follow: Follow, sourceId: string): Promise<CaptureResult> {
    if (this.#follow !== follow) return "failed";
    const result = await this.#replaceSource(sourceId);
    console.debug(
      "[follow] swap to",
      sourceId,
      result,
      result === "failed" ? this.#swapFailure : "",
    );
    if (result === "done") {
      follow.sourceId = sourceId;
      follow.stalledOn = undefined;
      // a new window starts without recaptures
      if (follow.refresh?.sourceId !== sourceId) follow.refresh = undefined;
    }
    return result;
  }

  /**
   * The captured window of the followed game ended. Wait a few seconds for
   * another window of the game, move the stream to it if one shows up and
   * stop the stream if none does (or the game stopped).
   */
  #followGrace(room: Room, gen: number) {
    const follow = this.#follow;
    if (!follow) return;
    console.debug("[follow] grace period starts");
    follow.grace = true;

    // A swap to another window may have run before this task, then the
    // stream shows a live window and has to be left alone
    const outdated = () => this.#follow !== follow || this.#trackGen !== gen;

    this.#swap(async () => {
      if (outdated()) return;
      // Wait long only when the game took its window away. If the window is
      // still listed, the capture was ended by hand (the browser's stop
      // sharing), so there is little to wait for.
      let games = await fetchRunningGames();
      if (outdated()) return;
      const listedFirst = windowListed(games, follow.gameId, follow.sourceId);
      // The desktop app has no browser bar to stop sharing by hand, so a
      // capture that ended there means the game took its window away
      const native = !!window.native;
      if (listedFirst && !native) {
        // the list can be a few seconds old and still hold the window that
        // just closed, so read it again before believing it
        await new Promise((resolve) =>
          setTimeout(resolve, FOLLOW_GRACE_RECHECK_MS),
        );
        if (outdated()) return;
        games = await fetchRunningGames();
        if (outdated()) return;
      }
      const waitMs = native
        ? FOLLOW_GRACE_MAX_MS
        : graceWaitMs(games, follow.gameId, follow.sourceId);
      console.debug(
        "[follow] grace wait",
        waitMs,
        "ms, window listed first:",
        listedFirst,
        "listed now:",
        windowListed(games, follow.gameId, follow.sourceId),
      );
      const deadline = Date.now() + waitMs;
      let fresh = false;

      while (!outdated()) {
        const sourceId = await this.#waitForWindow(follow, deadline, fresh);
        if (outdated()) return;
        if (!sourceId) break;

        const result = await this.#followSwap(follow, sourceId);
        if (result === "done" || outdated()) return;
        if (result === "failed") break;

        // the window was gone already: wait for the games to change
        fresh = true;
      }

      // stopped or switched by hand meanwhile
      if (outdated()) return;

      console.debug(
        "[follow] grace period over, stopping the stream, windows:",
        this.#followGames
          .find((g) => g.id === follow.gameId)
          ?.windows.map((w) => `${w.sourceId}/${w.role}`),
      );
      this.#endFollow();
      if (this.room() === room && this.screenshare()) {
        await this.toggleScreenshare();
      }
    }).finally(() => {
      follow.grace = false;
    });
  }

  /**
   * Wait for a window of the followed game other than the one that ended
   * @param deadline When to give up (Date.now() time)
   * @param fresh Only react to new updates, not to the games known now
   * @returns The source to capture, undefined when the game stopped or time
   * ran out
   */
  #waitForWindow(follow: Follow, deadline: number, fresh: boolean) {
    return new Promise<string | undefined>((resolve) => {
      let done = false;
      let stop = () => {};

      const finish = (value: string | undefined) => {
        if (done) return;
        done = true;
        follow.wake = undefined;
        clearTimeout(timer);
        stop();
        resolve(value);
      };
      // A game that is still running without a window keeps the wait going
      // up to the deadline; a missing game must be missing twice in a row
      let missed = 0;
      const check = (games: RunningGame[]) => {
        if (this.#follow !== follow) return finish(undefined);
        const result = graceWindow(
          games,
          follow.gameId,
          follow.sourceId,
          missed,
        );
        missed = result.missed;
        if (result.gone) finish(undefined);
        else if (result.sourceId) finish(result.sourceId);
        else if (missed === 1) {
          // read again to be sure it stopped
          setTimeout(() => {
            if (!done) fetchRunningGames().then(check);
          }, 2000);
        }
      };

      const timer = setTimeout(
        () => finish(undefined),
        Math.max(0, deadline - Date.now()),
      );
      stop = subscribeRunningGames(check);
      // ending follow mode ends the wait at once
      follow.wake = () => finish(undefined);
      if (!fresh) fetchRunningGames().then(check);
    });
  }

  /** Run a window swap once the ones before it are done */
  #swap<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#swapQueue.then(task, task);
    this.#swapQueue = result.catch(() => {});
    return result;
  }

  /**
   * Replace the captured screen of the running stream with a new capture
   * (from the picker, or the source set with setNextScreenSource) and keep
   * the stream going
   * @param sourceId Capture this source without the picker, undefined shows
   * the picker (or the portal)
   * @returns How it ended, `done` when the stream shows the new capture
   */
  async #replaceSource(sourceId?: string): Promise<CaptureResult> {
    const preselected = sourceId !== undefined;
    const room = this.room();
    const stream = this.streamOptions();
    // When the captured window closes, LiveKit unpublishes the ended track
    // by itself, so the publication can be gone while the share goes on
    const video =
      room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)
        ?.videoTrack ?? this.#currentVideo;
    const token = this.#shareToken;
    if (!room || !stream || !video || !token) {
      const missing = [
        !room && "room",
        !stream && "stream options",
        !video && "video track",
        !token && "share token",
      ].filter(Boolean);
      this.#swapFailure = `missing ${missing.join(", ")}`;
      console.debug("[follow] cannot replace the source:", this.#swapFailure);
      return "failed";
    }
    this.#swapFailure = undefined;

    const picked = this.#registerScreenPicker(preselected);
    this.#prepareCapture();

    // whether the stream we were asked to change is gone or another one
    const stale = () => this.#shareToken !== token || this.room() !== room;

    let tracks: LocalTrack[];
    try {
      try {
        if (preselected) await window.native.setNextScreenSource?.(sourceId);
        // stay in this tab, as when starting a share
        setScreenCaptureKeepFocus(true);
        const capturing = room.localParticipant.createScreenTracks({
          resolution: this.#screenShareQuality(
            stream.resolution,
            stream.frameRate,
          ).resolution,
          audio: STREAM_AUDIO_CAPTURE,
        });
        // Only a preselected capture is time limited: with the picker or
        // portal open, the user may take as long as they like
        tracks = preselected
          ? await withTimeout(capturing, "screen capture", (late) =>
              // arrived after we gave up
              late.forEach((t) => t.stop()),
            )
          : await capturing;
      } finally {
        setScreenCaptureKeepFocus(false);
        // the chosen source is used once, drop it if it wasn't
        if (preselected) window.native.setNextScreenSource?.(null);
      }
    } catch (e) {
      // closing the picker keeps streaming the current window
      logCaptureFailure("capture", e);
      if (picked.dismissed() || isCaptureCancelled(e)) return "cancelled";
      this.#swapFailure = `capture: ${e instanceof Error ? e.message : String(e)}`;
      if (e instanceof CaptureTimeout) {
        console.debug("[follow]", e.message);
        return "failed";
      }
      this.onErr(e);
      return "failed";
    }

    const newVideo = tracks.find(
      (t): t is LocalVideoTrack => t.kind === Track.Kind.Video,
    )!;
    const newAudio = tracks.find(
      (t): t is LocalAudioTrack => t.kind === Track.Kind.Audio,
    );

    // the stream ended while picking
    if (stale()) {
      this.#swapFailure = "the stream ended while capturing";
      tracks.forEach((t) => t.stop());
      return "failed";
    }

    let step = "unpublish";
    try {
      // Replacing the track of the running sender stays black with some
      // captures (game windows), so publish the new capture the way a fresh
      // share is: take down the old one first. The new tracks are captured
      // already, so a cancelled picker never gets here.
      const oldAudio = this.#streamAudio;
      const stillPublished =
        room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
          ?.track === video;
      if (stillPublished) {
        await room.localParticipant.unpublishTrack(video, false);
      } else {
        console.debug(
          "[follow] old capture was already unpublished, publishing the new one",
        );
      }
      video.stop();
      if (oldAudio) {
        if (this.#streamAudioShared(room)) {
          await room.localParticipant.unpublishTrack(oldAudio);
        }
        oldAudio.stop();
        if (this.#streamAudio === oldAudio) this.#streamAudio = undefined;
      }

      // the stream was stopped meanwhile: drop what we captured, quietly
      if (stale()) {
        this.#swapFailure = "the stream ended while unpublishing";
        tracks.forEach((t) => t.stop());
        return "failed";
      }

      // the picker is where audio gets chosen, so share whatever it captured
      step = "publish";
      const pickedOptions = picked();
      await this.#publishScreenshare(
        room,
        newVideo,
        newAudio,
        {
          resolution: pickedOptions?.resolution ?? stream.resolution,
          frameRate: pickedOptions?.frameRate ?? stream.frameRate,
          audio: !!newAudio,
        },
        true,
      );

      if (stale()) {
        this.#swapFailure = "the stream ended while publishing";
        // stopped while publishing, make sure nothing is left published
        await this.#stopScreenshare(room);
        tracks.forEach((t) => t.stop());
        return "failed";
      }
      return "done";
    } catch (e) {
      // errors from a stream that was stopped meanwhile are expected
      logCaptureFailure(step, e);
      this.#swapFailure = `${step}: ${e instanceof Error ? e.message : String(e)}`;
      // never leave the capture running (the OS shows it as active)
      tracks.forEach((t) => t.stop());
      if (!stale()) {
        // the old stream is down already, so the share is over
        await this.#stopScreenshare(room).catch(() => {});
        this.onErr(e);
      }
      return "failed";
    }
  }

  /**
   * Change the resolution, frame rate or audio of our stream while it keeps
   * going
   */
  openScreenshareSettings() {
    const room = this.room();
    const stream = this.streamOptions();
    const publication = room?.localParticipant.getTrackPublication(
      Track.Source.ScreenShare,
    );
    if (!room || !stream || !publication) return;

    this.openModal({
      type: "screen_share_settings",
      live: stream,
      trackReference: {
        participant: room.localParticipant,
        publication,
        source: Track.Source.ScreenShare,
      },
      resolutions: this.#resolutionOptions(),
      audio: !!this.#streamAudio,
      onCancel: () => {},
      callback: (resolution, frameRate, audio) =>
        this.#applyStreamOptions(room, { resolution, frameRate, audio }).catch(
          (e) => this.onErr(e),
        ),
    });
  }

  resetLayout() {
    this.#setLayout();
  }

  toggleLayout(type: VoiceLayout) {
    this.#setLayout((l) => (l === type ? undefined : type));
  }

  trackId(t: TrackReferenceOrPlaceholder) {
    return `${t.source}_${t.participant.sid}`;
  }

  toggleFocus(t?: TrackReferenceOrPlaceholder) {
    // nothing to focus: just make sure no focus is left behind
    if (!t) return this.clearFocus();

    const id = this.trackId(t);
    if (this.focusId() === id || this.vidTracks().length < 2) {
      this.#setFocus(undefined);
    } else {
      this.#focus(t!);
    }
  }

  /**
   * Drop the focus and bring the participant grid back
   */
  clearFocus() {
    batch(() => {
      this.#setFocus(undefined);
      this.#setShowBar(true);
    });
  }

  /**
   * Focus a track; a focused stream hides the others until asked for
   */
  #focus(t: TrackReferenceOrPlaceholder) {
    batch(() => {
      this.#setFocus(this.trackId(t));
      this.#setShowBar(t.source !== Track.Source.ScreenShare);
    });
  }

  /**
   * Focus a track, unless it is the only one
   */
  setFocusTrack(t: TrackReferenceOrPlaceholder) {
    if (this.vidTracks().length >= 2) this.#focus(t);
  }

  /**
   * Open a participant's screen share (our own included). With multi-stream
   * off it replaces whatever we were watching; either way the people who
   * aren't streaming get out of the way
   */
  watchStream(identity: string) {
    if (!this.#settings.multiStream) {
      for (const id of [...this.watching]) {
        if (id !== identity) this.#stopWatching(id);
      }
    }

    batch(() => {
      this.watching.add(identity);
      this.#setShowBar(false);
      this.#setPendingFocus(identity);
    });
  }

  multiStream() {
    return this.#settings.multiStream;
  }

  /**
   * Switch between watching several streams at once or one at a time;
   * going down to one keeps the stream opened last
   */
  setMultiStream(value: boolean) {
    this.#settings.multiStream = value;
    if (!value && this.watching.size > 1) {
      const last = [...this.watching].at(-1)!;
      for (const id of [...this.watching]) {
        if (id !== last) this.#stopWatching(id);
      }
      this.#setPendingFocus(last);
    }
  }

  /**
   * Called once the pending stream has been focused (or can't be)
   */
  clearPendingFocus() {
    this.#setPendingFocus();
  }

  /**
   * Whether a track is someone else's stream we haven't opened; those aren't
   * subscribed to (our own stream is always previewed)
   */
  isUnwatchedStream(t: TrackReferenceOrPlaceholder) {
    return (
      t.source === Track.Source.ScreenShare &&
      !t.participant.isLocal &&
      !this.watching.has(t.participant.identity)
    );
  }

  /**
   * Whether a track is a stream that is open in the call window
   */
  isWatchedStream(t: TrackReferenceOrPlaceholder) {
    return (
      t.source === Track.Source.ScreenShare &&
      this.watching.has(t.participant.identity)
    );
  }

  /**
   * Streams open in the call window
   */
  watchedStreams() {
    return this.vidTracks().filter((t) => this.isWatchedStream(t));
  }

  /**
   * Whether the call window tiles several streams side by side
   */
  isMultiStream() {
    return this.watchedStreams().length >= 2;
  }

  /**
   * Participants watching the given participant's stream
   */
  viewersOf(identity: string) {
    return [...this.viewing]
      .filter(([, streams]) => streams.includes(identity))
      .map(([viewer]) => viewer);
  }

  /**
   * Stop watching the given participant's stream, or every stream
   */
  leaveStream(identity?: string) {
    for (const id of identity ? [identity] : [...this.watching]) {
      this.#stopWatching(id);
    }

    // down to a single stream again: show it on its own
    this.settleAfterStreamGone();
  }

  /**
   * Forget a watched stream, along with any focus still waiting for it
   */
  #unwatch(identity: string) {
    batch(() => {
      this.watching.delete(identity);
      if (this.pendingFocus() === identity) this.#setPendingFocus();
    });
  }

  /**
   * Settle the layout after a watched stream went away: a single remaining
   * stream is shown on its own (bar stays hidden), otherwise a stale focus is
   * dropped and the participant grid returns
   */
  settleAfterStreamGone() {
    // a stream that is being republished is not gone, keep its view
    if (this.#pendingEnds.size) return;
    batch(() => {
      if (this.watching.size === 1) {
        this.#setPendingFocus([...this.watching][0]);
        if (!this.focusTrack()) this.#setFocus(undefined);
      } else if (this.watching.size === 0 || !this.focusTrack()) {
        this.clearFocus();
      }
    });
  }

  /**
   * Show the participant grid again
   */
  restoreBar() {
    this.#setShowBar(true);
  }

  #stopWatching(identity: string) {
    this.#unwatch(identity);

    const participant = this.room()?.getParticipantByIdentity(identity);
    for (const source of [
      Track.Source.ScreenShare,
      Track.Source.ScreenShareAudio,
    ]) {
      const pub = participant?.getTrackPublication(source);
      if (pub instanceof RemoteTrackPublication) pub.setSubscribed(false);
    }

    const focused = this.focusTrack();
    if (
      focused?.source === Track.Source.ScreenShare &&
      focused.participant.identity === identity
    ) {
      this.#setFocus(undefined);
    }

    // last stream left: the grid was collapsed for it, so bring it back
    if (this.watching.size === 0) this.#setShowBar(true);
  }

  isFocus(t: TrackReferenceOrPlaceholder) {
    return this.trackId(t) === this.focusId();
  }

  focusTrack() {
    const id = this.focusId();
    return id
      ? this.vidTracks().find((t) => this.trackId(t) === id)
      : undefined;
  }

  toggleShowBar() {
    this.#setShowBar((s) => !s);
  }

  getConnectedUser(userId: string) {
    return this.room()?.getParticipantByIdentity(userId);
  }

  showCard(channel: Channel) {
    return (
      channel.isVoice &&
      (this.channel()?.id === channel.id ||
        channel.type === "TextChannel" ||
        !!channel.voiceParticipants.size)
    );
  }

  getMicrophoneTrack(): LocalTrackPublication | undefined {
    const track = this.room()?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    );
    return track;
  }

  get listenPermission() {
    return !!this.channel()?.havePermission("Listen");
  }

  get speakingPermission() {
    return !!this.channel()?.havePermission("Speak");
  }

  private onErr(e: unknown) {
    if ((e as Error).name !== "NotAllowedError")
      this.openModal({ type: "error2", error: e });
  }
}

const voiceContext = createContext<Voice>(null as unknown as Voice);

/**
 * Mount global voice context and room audio manager
 */
export function VoiceContext(props: { children: JSX.Element }) {
  const state = useState();
  const modals = useModals();
  const sound = useSound();
  const device = useDevice();
  const voice = new Voice(state.voice, modals, sound, device);

  return (
    <voiceContext.Provider value={voice}>
      <RoomContext.Provider value={voice.room}>
        <VoiceCallCardContext>{props.children}</VoiceCallCardContext>
        <InRoom>
          <RoomAudioManager />
          <VoiceKeybinds />
          <StreamViewers />
        </InRoom>
        <StatsRecorder />
        <CallSounds />
        <VoiceMoves />
      </RoomContext.Provider>
    </voiceContext.Provider>
  );
}

export const useVoice = () => useContext(voiceContext);
