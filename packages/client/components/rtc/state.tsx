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

import { SoundController, useClient, useSound } from "@revolt/client";
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
import { watchCallTraffic } from "@revolt/traffic";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { Device, useDevice } from "@revolt/common";
import { CallSounds } from "./components/CallSounds";
import { E2eeNotices } from "./components/E2eeNotices";
import { GamepadPushToTalk } from "./components/GamepadPushToTalk";
import { InRoom } from "./components/InRoom";
import { MuteKeybinds } from "./components/MuteKeybinds";
import { OverlayPublisher } from "./components/OverlayPublisher";
import { RoomAudioManager } from "./components/RoomAudioManager";
import { StatsRecorder } from "./components/StatsRecorder";
import { StreamPopouts } from "./components/StreamPopouts";
import { StreamViewers } from "./components/StreamViewers";
import { VoiceKeybinds } from "./components/VoiceKeybinds";
import { VoiceMoves } from "./components/VoiceMoves";
import {
  type E2eeFailureKind,
  CallE2ee,
  isCallE2eeSupported,
} from "./e2ee/callE2ee";
import { decideFocusedGameStream } from "./focusedGame";
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
  type PttSource,
  micShouldBeOn,
  PTT_RELEASE_DELAY_MS,
  pttHeld,
} from "./pushToTalk";
import {
  allowMicRestart,
  isPermanentJoinError,
  rejoinDelayMs,
  sdkRetryDelayMs,
  shouldKeepRejoining,
  shouldRejoin,
} from "./reconnect";
import { shouldRewatch } from "./rewatch";
import {
  fetchRunningGames,
  gameDetectionAvailable,
  subscribeRunningGames,
} from "./runningGames";
import {
  setScreenCaptureKeepFocus,
  setScreenCaptureLimit,
} from "./screenCapture";
import {
  FOLLOW_ATTRIBUTE,
  followCleared,
  isFollowing,
  republishWaitMs,
} from "./streamFollow";
import {
  type PopoutKind,
  openPopoutWindow,
  pickPopoutApi,
  popoutSize,
} from "./streamPopout";
import { VoiceProcessor } from "./VoiceProcessor";

/** Why E2EE kept us out of a call or ended it: no browser support, worker or key exchange failure */
export type E2eeNotice = { kind: "unsupported" | E2eeFailureKind };

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

/** How long setting the follow attribute may delay what waits for it */
const FOLLOW_ATTRIBUTE_TIMEOUT_MS = 1500;

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

  /** Id of the logged in user, which is our LiveKit identity */
  #selfId: () => string | undefined;

  /** When people last moved into or out of our channel, by user id */
  #movedAt = new Map<string, number>();

  channel: Accessor<Channel | undefined>;
  #setChannel: Setter<Channel | undefined>;

  room: Accessor<Room | undefined>;
  #setRoom: Setter<Room | undefined>;

  /**
   * End-to-end encryption of the current call (state for the UI: per
   * participant trust, own encryption active, failures)
   */
  e2ee: Accessor<CallE2ee | undefined>;
  #setE2ee: Setter<CallE2ee | undefined>;

  /**
   * True when the last join was refused because this browser cannot encrypt
   * call media (everyone else refuses unencrypted participants)
   */
  e2eeUnsupported: Accessor<boolean>;
  #setE2eeUnsupported: Setter<boolean>;

  /**
   * Set (to a new object each time) when E2EE kept us out of a call or ended
   * it, for the notice that tells the user (see E2eeNotices)
   */
  e2eeNotice: Accessor<E2eeNotice | undefined>;
  #setE2eeNotice: Setter<E2eeNotice | undefined>;

  /** The last join was refused for an E2EE reason; retrying won't help */
  #e2eeRefused = false;

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

  /** The clearing of the follow attribute that is under way, if any */
  #followClear?: Promise<void>;

  /** Whether a "stream focused game" press is still being handled */
  #focusedGameBusy = false;

  /**
   * Set once the server turned out not to let us set attributes (plain
   * Stoat), the follow attribute is then left alone for this call. Any
   * rejection counts, even a transient timeout: that disables follow sharing
   * for the rest of the call on purpose, so a stop is never delayed again.
   */
  #followUnsupported = false;

  /**
   * Streams shown in a window of their own, by track id (see trackId). Each
   * entry holds the window; it never changes what is watched or focused.
   */
  popouts = new ReactiveMap<string, StreamPopout>();

  /**
   * People whose stream was unpublished a moment ago: a window swap
   * republishes it, which must not look like the stream ended
   */
  #pendingEnds = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      sound: boolean;
      since: number;
      focused: boolean;
      /** Ends the stream now instead of when the timer fires */
      end: () => void;
    }
  >();

  /**
   * Viewed streams that counted as ended (not stopped by the viewer): who
   * streamed, the time it ended and whether it was focused. A stream that
   * comes back soon after is watched again, see shouldRewatch
   */
  #endedWatches = new Map<string, { at: number; focused: boolean }>();

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

  /** Stops recording the call's traffic for the traffic inspector. */
  #stopCallTraffic?: () => void;

  /**
   * Participants whose screen share we chose to watch; other streams are
   * not subscribed to, so they cost no bandwidth until someone opens them
   */
  watching = new ReactiveSet<string>();

  /**
   * People whose stream was unpublished a moment ago and is waited for, see
   * #pendingEnds (this one is reactive, for showing a placeholder)
   */
  endingStreams = new ReactiveSet<string>();

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
    selfId: () => string | undefined,
  ) {
    this.#settings = voiceSettings;
    this.#selfId = selfId;
    // the windows belong to this page, don't leave them behind when it goes
    window.addEventListener("pagehide", () => this.closeAllPopouts());
    this.sound = sound;
    this.device = device;

    const [channel, setChannel] = createSignal<Channel>();
    this.channel = channel;
    this.#setChannel = setChannel;

    const [room, setRoom] = createSignal<Room>();
    this.room = room;
    this.#setRoom = setRoom;

    const [e2ee, setE2ee] = createSignal<CallE2ee>();
    this.e2ee = e2ee;
    this.#setE2ee = setE2ee;

    const [e2eeUnsupported, setE2eeUnsupported] = createSignal(false);
    this.e2eeUnsupported = e2eeUnsupported;
    this.#setE2eeUnsupported = setE2eeUnsupported;

    const [e2eeNotice, setE2eeNotice] = createSignal<E2eeNotice>();
    this.e2eeNotice = e2eeNotice;
    this.#setE2eeNotice = setE2eeNotice;

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

    // Everyone in a call encrypts and refuses participants who don't, so
    // joining without E2EE would only make us unheard and unseen. Refuse.
    // Done before the wake lock and the output bus are started, so a refusal
    // leaves nothing behind.
    this.#e2eeRefused = false;
    this.#setE2eeUnsupported(false);
    if (!isCallE2eeSupported()) {
      console.error(
        "[e2ee] this browser cannot encrypt call media, not joining the call",
      );
      this.#setE2eeUnsupported(true);
      this.#refuseE2ee("unsupported");
      return;
    }

    // Frame encryption keys and worker; own LiveKit identity is the user id
    let e2ee: CallE2ee;
    try {
      const selfId = this.#selfId();
      if (!selfId) throw new Error("not logged in");
      e2ee = new CallE2ee(selfId, (kind) => {
        // only the call this belongs to; leaving also stops any rejoin
        if (this.e2ee() !== e2ee) return;
        this.#setE2eeNotice({ kind });
        this.disconnect();
      });
    } catch (err) {
      console.error("[e2ee] could not set up call encryption", err);
      this.#refuseE2ee("worker");
      return;
    }

    // Safari: start the audio output bus while still inside the tap that
    // joined the call (before the first await), it needs a gesture
    if (outputBus.isBusMode()) {
      outputBus.prime(this.#settings.preferredAudioOutputDevice);
    }

    this.device.setWakeLocked();

    let room: Room;
    try {
      room = this.#createRoom(e2ee);
    } catch (err) {
      console.error("[e2ee] could not create the room", err);
      e2ee.dispose();
      this.device.releaseWakeLock();
      outputBus.teardown();
      this.#refuseE2ee("start");
      return;
    }

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
          // tracks without encryption are refused (see CallE2ee) and never shown
          (t.participant.isLocal ||
            !t.publication ||
            t.publication.isEncrypted) &&
          (t.source === Track.Source.ScreenShare ||
            !streaming.has(t.participant.identity)),
      );
    });

    batch(() => {
      this.#setE2ee(e2ee);
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
      const publishMic = () => {
        if (this.speakingPermission && this.#settings.inputMode === "ptt") {
          // push to talk starts with the mic closed, the key opens it. micOn is
          // the user's mute choice and stays as it is.
          this.#publishMutedMicrophone(room);
        } else if (this.speakingPermission)
          // the microphone state the user had (muted or not) is in the settings;
          // while deafened the mic stays closed and micOn stays as it is
          room.localParticipant
            .setMicrophoneEnabled(this.#micWanted())
            .then((track) => {
              // only a mic we asked for can tell that opening it failed
              if (this.#micWanted()) this.#settings.micOn = track != null;
            })
            // MediaDevicesError tells what went wrong
            .catch((err) => console.warn("[rtc] could not start the mic", err));
      };
      // nothing is published before our key is installed and the hello is
      // out, otherwise the first audio would be sent without a usable key
      e2ee.start(room).then(
        () => {
          if (this.room() !== room) return;
          publishMic();
        },
        // CallE2ee already told the user and left the call
        (err) => console.error("[e2ee] could not start", err),
      );
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
        if (screenShareTrack?.isEncrypted) {
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
      this.#endedWatches.delete(participant.identity);
    });

    room.addListener("trackPublished", (pub, participant) => {
      // streams aren't watched automatically, so announce them right away;
      // an unencrypted one is refused (see CallE2ee), not worth announcing
      if (pub.source === Track.Source.ScreenShare && pub.isEncrypted) {
        // back after a window swap: not a new stream
        if (!this.#cancelPendingEnd(participant.identity)) {
          this.sound.playSound("streamStart");
          this.#rewatchEnded(participant.identity);
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

    // The streamer says follow mode is over: a pending end is final
    room.addListener("participantAttributesChanged", (changed, participant) => {
      const pending = this.#pendingEnds.get(participant.identity);
      if (!pending || !followCleared(changed, participant.attributes)) return;
      console.debug(
        "[rtc] follow attribute cleared for",
        participant.identity,
        ", ending the stream now after",
        Date.now() - pending.since,
        "ms",
      );
      pending.end();
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
      e2ee.dispose();
      return;
    }

    if (!auth) {
      auth = await channel.joinCall(selected);
    }

    // left or joined elsewhere while waiting
    if (this.room() !== room || (rejoin && rejoin.cancelled)) {
      room.removeAllListeners();
      room.disconnect();
      e2ee.dispose();
      return;
    }

    // the traffic inspector records the call while it is on (no-op otherwise)
    this.#stopCallTraffic?.();
    this.#stopCallTraffic = watchCallTraffic(room, {
      url: auth.url,
      e2ee: () => e2ee.state.active,
    });

    await room.connect(auth.url, auth.token, {
      autoSubscribe: false,
      maxRetries: 3,
      peerConnectionTimeout: PEER_CONNECTION_TIMEOUT_MS,
    });
  }

  /** Builds the LiveKit room with our options and end-to-end encryption */
  #createRoom(e2ee: CallE2ee): Room {
    const room = new Room({
      // Only receive video at the size it is displayed. Not paused while this
      // page is in the background: a stream popup window (the fallback for
      // Document Picture-in-Picture) would freeze when AnyTalk is minimized.
      // The trade-off is that a hidden tab keeps receiving its video.
      adaptiveStream: { pauseVideoInBackground: false },
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
      // end-to-end encrypted media (not the `encryption` option, data
      // messages must stay readable for the server-side relays)
      e2ee: e2ee.roomOptions(),
    });
    e2ee.attach(room);
    return room;
  }

  /**
   * Stay out of the call for an E2EE reason and tell the user. Retrying
   * can't help, so the rejoin loop stops too (see #startRejoin).
   */
  #refuseE2ee(kind: E2eeNotice["kind"]) {
    this.#e2eeRefused = true;
    batch(() => {
      this.#setE2eeNotice({ kind });
      this.#setState("DISCONNECTED");
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
          // E2EE can't work here (browser, worker): trying again won't help
          if (this.#e2eeRefused) {
            this.#teardown(true);
            this.#rejoin = undefined;
            this.#setState("DISCONNECTED");
            return;
          }
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

  /**
   * Whether each push to talk source (keyboard, controller) holds it, or let
   * go a moment ago. The mic stays open while any source holds it.
   */
  #pttSources: Record<PttSource, boolean> = { keys: false, pad: false };

  /** Closes the mic shortly after a source let go */
  #pttTimers: Partial<
    Record<PttSource, ReturnType<typeof setTimeout> | undefined>
  > = {};

  /** Whether the settings and push to talk key say the mic should send */
  #micWanted() {
    return micShouldBeOn({
      speak: this.speakingPermission,
      deafen: this.#settings.deafen,
      micOn: this.#settings.micOn,
      mode: this.#settings.inputMode,
      pttOpen: pttHeld(this.#pttSources),
    });
  }

  /**
   * Open or close the microphone to match the input mode, the mute and deafen
   * state and the push to talk key. Never changes the persisted mute choice.
   */
  syncMicrophone() {
    // a push to talk key can't be held in the other mode
    if (this.#settings.inputMode !== "ptt") this.#releasePushToTalk();
    if (this.#micSyncing) return; // the running sync checks again when done
    this.#micSyncing = true;

    (async () => {
      try {
        // a few rounds at most, in case the state keeps changing
        for (let round = 0; round < 5; round++) {
          const room = this.room();
          if (!room) return;
          const wanted = this.#micWanted();
          if (room.localParticipant.isMicrophoneEnabled === wanted) return;
          try {
            await room.localParticipant.setMicrophoneEnabled(wanted);
          } catch (err) {
            console.warn("[rtc] could not switch the mic", err);
            // repeat only if the wish changed meanwhile, not to retry a failure
            if (this.#micWanted() === wanted) return;
          }
        }
      } finally {
        // cleared in the same tick as the last check, so no call is lost
        this.#micSyncing = false;
      }
      // out of rounds: look once more in case it still differs
      const room = this.room();
      if (
        room &&
        room.localParticipant.isMicrophoneEnabled !== this.#micWanted()
      )
        setTimeout(() => this.syncMicrophone(), 250);
    })();
  }

  /** Whether a syncMicrophone run is in flight */
  #micSyncing = false;

  /**
   * Push to talk join: capture the microphone and publish it already muted,
   * so the permission prompt comes now and the key opens it without delay.
   * The track is muted before publishing, so no audio is sent.
   */
  #publishMutedMicrophone(room: Room) {
    if (!this.#settings.micOn) return;
    this.#micSyncing = true;
    (async () => {
      const [track] = await room.localParticipant.createTracks({
        audio: true,
        video: false,
      });
      if (!track) return;
      await track.mute();
      if (this.room() !== room || room.state !== "connected") {
        track.stop();
        return;
      }
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
      });
    })()
      .catch((err) => console.warn("[rtc] could not start the mic", err))
      .finally(() => {
        this.#micSyncing = false;
        // the key may have been pressed or the mode changed meanwhile
        this.syncMicrophone();
      });
  }

  /**
   * A push to talk source went down (true) or up (false). Releasing keeps the
   * mic on for a moment so the end of the word isn't cut off. Does nothing
   * unless the input mode is push to talk.
   * @param down Whether it is held
   * @param source Keyboard (default) or controller; they work independently
   */
  pushToTalk(down: boolean, source: PttSource = "keys") {
    clearTimeout(this.#pttTimers[source]);
    this.#pttTimers[source] = undefined;
    if (this.#settings.inputMode !== "ptt") return;

    if (down) {
      this.#pttSources[source] = true;
      this.syncMicrophone();
    } else if (this.#pttSources[source]) {
      this.#pttTimers[source] = setTimeout(() => {
        this.#pttTimers[source] = undefined;
        this.#pttSources[source] = false;
        this.syncMicrophone();
      }, PTT_RELEASE_DELAY_MS);
    }
  }

  /**
   * Let go of one push to talk source at once, without the tail (the
   * controller button was changed, or its shell support went away)
   */
  releasePushToTalkSource(source: PttSource) {
    clearTimeout(this.#pttTimers[source]);
    this.#pttTimers[source] = undefined;
    if (!this.#pttSources[source]) return;
    this.#pttSources[source] = false;
    this.syncMicrophone();
  }

  /** Close every push to talk source at once (leaving the call, mode change) */
  #releasePushToTalk() {
    for (const source of ["keys", "pad"] as const) {
      clearTimeout(this.#pttTimers[source]);
      this.#pttTimers[source] = undefined;
      this.#pttSources[source] = false;
    }
  }

  /** Whether our microphone is meant to be sending */
  #micShouldWork() {
    const local = this.getMicrophoneTrack()?.audioTrack;
    return this.#micWanted() && !!local && !local.isMuted;
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
        if (this.room() !== room || !this.#micWanted()) return;
        if (room.localParticipant.isMicrophoneEnabled) return;
        // through the serialised sync, so it can't double publish
        this.syncMicrophone();
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
    // when the stream first went away, kept over repeated unpublishes
    const since = previous?.since ?? Date.now();
    // whether the stream was focused when it went away: the track is
    // already gone from vidTracks() when the end fires
    const focused = previous
      ? previous.focused
      : this.#isFocusedStream(identity);
    // a streamer in follow mode swaps sources slowly, wait longer for it
    const waitMs = republishWaitMs(
      this.room()?.getParticipantByIdentity(identity)?.attributes,
      STREAM_REPUBLISH_WAIT_MS,
    );
    const end = () => {
      const pending = this.#pendingEnds.get(identity);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pendingEnds.delete(identity);
      this.endingStreams.delete(identity);
      console.debug(
        "[rtc] stream end fired for",
        identity,
        "unpublished for",
        Date.now() - since,
        "ms, watched:",
        this.watching.has(identity),
        waitMs === STREAM_REPUBLISH_WAIT_MS ? "" : "(follow wait used)",
      );
      if (this.watching.has(identity)) {
        const now = Date.now();
        // forget entries that are too old to be used
        for (const [id, entry] of this.#endedWatches) {
          if (!shouldRewatch(entry.at, now)) this.#endedWatches.delete(id);
        }
        this.#endedWatches.set(identity, { at: now, focused });
      }
      if (withSound) this.sound.playSound("streamEnd");
      this.#unwatch(identity);
      this.settleAfterStreamGone();
    };
    this.endingStreams.add(identity);
    this.#pendingEnds.set(identity, {
      sound: withSound,
      since,
      focused,
      end,
      timer: setTimeout(end, waitMs),
    });
  }

  /**
   * Watch a stream again that ended a short while ago and is now published
   * again (the streamer's swap took longer than we waited)
   * @param identity Who started streaming
   */
  #rewatchEnded(identity: string) {
    const ended = this.#endedWatches.get(identity);
    this.#endedWatches.delete(identity);
    if (!ended || !shouldRewatch(ended.at, Date.now())) return;
    const othersWatched = [...this.watching].some((id) => id !== identity);
    // never pull the viewer off another stream they picked meanwhile
    if (othersWatched && !this.#settings.multiStream) return;
    console.debug(
      "[rtc] watching",
      identity,
      "again, stream came back after",
      Date.now() - ended.at,
      "ms, focused:",
      ended.focused,
    );
    if (ended.focused && !othersWatched && !this.focusId()) {
      this.watchStream(identity);
    } else {
      this.watching.add(identity);
    }
  }

  /**
   * Whether the focused stream is one that was unpublished a moment ago and
   * is waited for, its tile is missing meanwhile
   */
  focusedStreamEnding() {
    return [...this.endingStreams].some((id) => this.#isFocusedStream(id));
  }

  /**
   * Whether the participant's screen share is the focused tile
   * @param identity Who streams
   */
  #isFocusedStream(identity: string) {
    const sid = this.room()?.getParticipantByIdentity(identity)?.sid;
    return !!sid && this.focusId() === `${Track.Source.ScreenShare}_${sid}`;
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
    this.endingStreams.delete(identity);
    // an end that was held back by this one no longer has to wait
    if (!this.#pendingEnds.size) this.settleAfterStreamGone();
    return true;
  }

  /**
   * Clean up the room
   * @param forRejoin Keep the channel and what is watched, to get back into
   * the call; nothing is told to the user
   */
  #teardown(forRejoin: boolean) {
    // the tracks of the old room are gone
    this.closeAllPopouts();
    // the room goes away, nobody needs to be told
    this.#endFollow(false);
    this.#shareToken = undefined;
    this.#currentVideo = undefined;
    this.#pendingEnds.forEach((p) => clearTimeout(p.timer));
    this.#pendingEnds.clear();
    this.endingStreams.clear();
    this.#endedWatches.clear();
    this.#followUnsupported = false;
    this.#cancelCapture();
    this.#cancelMicRecovery();
    this.#stopWatchingMic();
    this.#releasePushToTalk();
    outputBus.teardown();
    this.device.releaseWakeLock();
    this.#releaseAudioUnlock?.();
    this.#releaseAudioUnlock = undefined;
    this.#stopCallTraffic?.();
    this.#stopCallTraffic = undefined;
    // stops the key exchange and terminates the E2EE worker of the old room,
    // after the room is disconnected so tracks can still be released
    const e2ee = this.e2ee();
    this.#setE2ee();
    try {
      const room = this.room();
      if (!room) return;

      room.removeAllListeners();
      room.disconnect();
      e2ee?.dispose();

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
      this.#endedWatches.clear();
      this.#setPendingFocus();

      this.sound.playSound("userLeaveVoice");
    } catch (e) {
      this.onErr(e);
    } finally {
      e2ee?.dispose();
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
      if (!room) {
        // outside a call only the saved choice changes, the next call uses it
        this.#settings.deafen = !this.#settings.deafen;
        if (fromMute) this.#settings.micOn = true;
        this.sound.playSound(this.#settings.deafen ? "deafen" : "undeafen");
        return;
      }
      if (this.#settings.inputMode === "ptt") {
        // the key decides whether the mic is open, so only the flags change
        this.#settings.deafen = !this.#settings.deafen;
        if (fromMute) this.#settings.micOn = true;
        this.syncMicrophone();
        this.#shareDeafen(room);
        this.sound.playSound(this.#settings.deafen ? "deafen" : "undeafen");
        return;
      }
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
      if (!room) {
        // outside a call only the saved choice changes, the next call uses it
        this.#settings.micOn = !this.#settings.micOn;
      } else if (this.#settings.inputMode === "ptt") {
        // in push to talk, mute is a hard mute the key can't override
        this.#settings.micOn = !this.#settings.micOn;
        this.syncMicrophone();
      } else {
        await room.localParticipant.setMicrophoneEnabled(
          !room.localParticipant.isMicrophoneEnabled,
        );

        this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;
      }

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
    // viewers must know it is over before the track goes away
    await this.#endFollow();
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
    await this.#endFollow();
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

  /**
   * The "stream focused game" hotkey: starts a stream of the game in front,
   * swaps to it when another game is streamed, or stops the stream. Does
   * nothing outside a call, without game detection or without a game.
   * Pressing it while AnyTalk is in front and a stream runs stops the
   * stream, since no game is focused then. A press while the previous one
   * is still being handled is ignored.
   */
  async toggleFocusedGameStream() {
    if (this.#focusedGameBusy) return;
    if (!this.room() || !gameDetectionAvailable()) return;
    this.#focusedGameBusy = true;
    try {
      await this.#toggleFocusedGameStream();
    } finally {
      this.#focusedGameBusy = false;
    }
  }

  /** The work of toggleFocusedGameStream, one press at a time */
  async #toggleFocusedGameStream() {
    const games = await fetchRunningGames();
    if (games.length === 0) return;

    let focusedGameId: string | undefined;
    try {
      // missing in older desktop builds: then no game counts as focused
      focusedGameId = (await window.native.getFocusedGame?.())?.id;
    } catch (e) {
      console.debug("[games] could not read the focused game:", e);
    }
    // a game that is no longer detected can't be streamed
    if (!games.some((g) => g.id === focusedGameId)) focusedGameId = undefined;

    const decision = decideFocusedGameStream(
      this.screenshare(),
      this.followedGameId(),
      games.map((g) => g.id),
      focusedGameId,
    );
    try {
      if (decision.action === "stop") {
        await this.toggleScreenshare();
      } else if (decision.action !== "none") {
        await this.startGameStream(decision.gameId);
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  /** Start following a game with the stream showing the given window */
  #beginFollow(gameId: string, sourceId: string) {
    // the attribute is set right after, no need to clear it in between
    this.#endFollow(false);

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
    this.#shareFollow(true);
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

  /**
   * Tell the viewers that follow mode is on or off, so they wait for the
   * next source instead of counting the stream as ended. Never rejects and
   * gives up after a moment, stopping a stream must not hang on it.
   * @param on Whether follow mode is on
   */
  async #shareFollow(on: boolean) {
    const room = this.room();
    if (!room || this.#followUnsupported) return;
    // plain Stoat gives no right to set attributes: don't even try
    if (room.localParticipant.permissions?.canUpdateMetadata === false) {
      this.#followUnsupported = true;
      console.debug("[rtc] not allowed to set attributes, follow not shared");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        room.localParticipant.setAttributes({
          [FOLLOW_ATTRIBUTE]: on ? "1" : "",
        }),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, FOLLOW_ATTRIBUTE_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      // the server rejected it: stop asking for the rest of the call
      this.#followUnsupported = true;
      console.debug(
        "[rtc] could not share follow state, not trying again",
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stop following a game, the stream itself is left alone
   * @param tell Tell the viewers, false when the room goes away anyway
   * @returns Resolves once the viewers were told (or it took too long)
   */
  #endFollow(tell = true): Promise<void> {
    const wasFollowing = !!this.#follow;
    if (this.#follow) console.debug("[follow] end", this.#follow.gameId);
    clearInterval(this.#stallTimer);
    this.#stallTimer = undefined;
    this.#follow?.wake?.();
    this.#follow?.stop();
    this.#follow = undefined;
    this.#followGames = [];
    this.#setFollowedGameId();
    if (!tell) {
      this.#followClear = undefined;
      return Promise.resolve();
    }
    if (this.#followUnsupported) return Promise.resolve();
    // a clear under way is waited for too; the attribute still being set
    // means an earlier clear failed, so it is tried again
    const stillSet = isFollowing(this.room()?.localParticipant.attributes);
    if (wasFollowing || stillSet) {
      const clear = this.#shareFollow(false).finally(() => {
        if (this.#followClear === clear) this.#followClear = undefined;
      });
      this.#followClear = clear;
      return clear;
    }
    return this.#followClear ?? Promise.resolve();
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
      await this.#endFollow();
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
   * The watched stream filling the multi-stream view, if one is focused.
   * The other streams stay watched and subscribed underneath it.
   */
  multiFocusTrack() {
    if (!this.isMultiStream()) return undefined;
    const track = this.focusTrack();
    return track && this.isWatchedStream(track) ? track : undefined;
  }

  /**
   * Enlarge a stream of the multi-stream view, or go back to the grid when
   * it is already enlarged. Only the focus changes: no stream is stopped and
   * the bar of other participants keeps its state.
   */
  toggleMultiFocus(t: TrackReferenceOrPlaceholder) {
    const id = this.trackId(t);
    this.#setFocus(this.focusId() === id ? undefined : id);
  }

  /**
   * Go back to the multi-stream grid, leaving the bar as it is
   */
  clearMultiFocus() {
    if (this.focusId()) this.#setFocus(undefined);
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
    // an older end timer must not undo this
    this.#cancelPendingEnd(identity);
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
    // defensive: the stream window also clears a focus left over when a
    // second stream opens, this covers 2+ streams already being watched
    if (value && this.isMultiStream()) this.clearMultiFocus();
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

  /**
   * Stop watching a stream for good: unsubscribe it, drop its focus and
   * forget any pending end or re-watch for it
   * @param identity Who streamed
   */
  #stopWatching(identity: string) {
    this.#cancelPendingEnd(identity);
    this.#unwatch(identity);
    this.#endedWatches.delete(identity);

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

  /**
   * How a stream can be popped out on this device, undefined if it can't
   */
  get popoutKind(): PopoutKind | undefined {
    return pickPopoutApi(
      window,
      // touch-only means no mouse or trackpad at all: a touchscreen on a
      // laptop still has a fine pointer
      !matchMedia("(any-pointer: fine)").matches,
      typeof window.open === "function",
      // the desktop app opens a normal window of its own, never a floating one
      !!window.native,
    );
  }

  /**
   * Whether the track is shown in a window of its own
   */
  isPoppedOut(t: TrackReferenceOrPlaceholder) {
    return this.popouts.has(this.trackId(t));
  }

  /**
   * Show a track in a window of its own that can be moved to another screen.
   * Has to be called from a click or key press, browsers refuse windows
   * otherwise. Watching and focus stay as they are.
   * @param t The track
   * @param title Name shown in the title of the window
   * @param dimensions Size of the video, for the starting size of the window
   * @returns Whether a window is open for the track now
   */
  async popOut(
    t: TrackReferenceOrPlaceholder,
    title: string,
    dimensions?: { width: number; height: number },
  ) {
    const id = this.trackId(t);
    if (this.popouts.has(id)) return true;

    const kind = this.popoutKind;
    if (!kind) return false;

    // never show or subscribe to a track without encryption (see CallE2ee);
    // checked first so an open window isn't closed for nothing
    if (
      t.publication instanceof RemoteTrackPublication &&
      !t.publication.isEncrypted
    ) {
      return false;
    }

    // Document Picture-in-Picture allows a single window: the stream that was
    // in it goes back to its tile. (Opening a new one would end it anyway, but
    // this keeps the state in step without waiting for the old window's event.)
    if (kind === "pip") {
      for (const [other, popout] of [...this.popouts]) {
        if (popout.kind === "pip") this.closePopout(other);
      }
    }

    // a track we stopped receiving would show black in the window
    if (t.publication instanceof RemoteTrackPublication)
      t.publication.setSubscribed(true);

    // no second try with another API: a failed request has used up the user
    // activation a popup needs
    try {
      const { win, stopFollowing } = await openPopoutWindow(kind, {
        title,
        ...popoutSize(dimensions),
        name: id.replace(/[^a-zA-Z0-9]/g, "_"),
      });

      // the track may have been popped out or the call left meanwhile
      if (this.popouts.has(id) || !this.room()) {
        stopFollowing();
        win.close();
        return this.popouts.has(id);
      }

      this.#registerPopout(id, kind, win, stopFollowing);
      return true;
    } catch (e) {
      console.debug("[rtc] could not pop out the stream with", kind, e);
    }

    return false;
  }

  /**
   * Keep track of an opened window: forget it when it is closed
   */
  #registerPopout(
    id: string,
    kind: PopoutKind,
    win: Window,
    stopFollowing: () => void,
  ) {
    const onGone = () => this.#dropPopout(id, win);
    win.addEventListener("pagehide", onGone);
    // a popup can't always tell that it was closed, so look for it too
    const poll =
      kind === "popup" ? setInterval(() => win.closed && onGone(), 500) : 0;

    this.popouts.set(id, {
      win,
      kind,
      dispose: () => {
        stopFollowing();
        win.removeEventListener("pagehide", onGone);
        if (poll) clearInterval(poll);
      },
    });
  }

  /**
   * Move a stream from its Document Picture-in-Picture window (which Chrome
   * doesn't let go fullscreen) into a normal popup window. The stream never
   * goes back to its tile in between and watching and focus stay as they are.
   *
   * Call it straight from a click, with nothing awaited before: the popup
   * is opened synchronously, while the user activation is still there.
   * @param id Track id (see trackId)
   * @returns Whether the stream is in a popup now, on failure the old window
   * stays open
   */
  async reopenPopoutAsWindow(id: string) {
    const old = this.popouts.get(id);
    if (!old || old.kind === "popup" || typeof window.open !== "function")
      return false;

    try {
      // synchronous up to the window.open inside
      const opening = openPopoutWindow("popup", {
        title: old.win.document.title,
        width: old.win.innerWidth || popoutSize().width,
        height: old.win.innerHeight || popoutSize().height,
        name: id.replace(/[^a-zA-Z0-9]/g, "_"),
      });
      const { win, stopFollowing } = await opening;

      // the old window went away meanwhile (track ended, call left)
      if (this.popouts.get(id) !== old) {
        stopFollowing();
        win.close();
        return false;
      }

      // replacing the entry swaps the content over without the tile showing
      // the video in between
      old.dispose();
      this.#registerPopout(id, "popup", win, stopFollowing);
      try {
        old.win.close();
      } catch {
        // already gone
      }
      return true;
    } catch (e) {
      console.debug("[rtc] could not move the stream to a popup", e);
      return false;
    }
  }

  /**
   * Forget the window of a track that was closed by the user
   */
  #dropPopout(id: string, win: Window) {
    const popout = this.popouts.get(id);
    if (!popout || popout.win !== win) return;
    popout.dispose();
    this.popouts.delete(id);
  }

  /**
   * Close the window of a track, if it has one
   * @param id Track id (see trackId)
   */
  closePopout(id: string) {
    const popout = this.popouts.get(id);
    if (!popout) return;
    popout.dispose();
    this.popouts.delete(id);
    try {
      popout.win.close();
    } catch {
      // already gone
    }
  }

  /**
   * Close every stream window
   */
  closeAllPopouts() {
    for (const id of [...this.popouts.keys()]) this.closePopout(id);
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

/** A stream shown in a window of its own */
export type StreamPopout = {
  /** The window the stream is shown in */
  win: Window;
  /** Which API opened it */
  kind: PopoutKind;
  /** Stop following the window, called when it goes away */
  dispose: () => void;
};

const voiceContext = createContext<Voice>(null as unknown as Voice);

/**
 * Mount global voice context and room audio manager
 */
export function VoiceContext(props: { children: JSX.Element }) {
  const state = useState();
  const modals = useModals();
  const sound = useSound();
  const device = useDevice();
  const client = useClient();
  const voice = new Voice(
    state.voice,
    modals,
    sound,
    device,
    () => client()?.user?.id,
  );

  return (
    <voiceContext.Provider value={voice}>
      <RoomContext.Provider value={voice.room}>
        <VoiceCallCardContext>{props.children}</VoiceCallCardContext>
        <InRoom>
          <RoomAudioManager />
          <VoiceKeybinds />
          <StreamViewers />
          <StreamPopouts />
        </InRoom>
        <StatsRecorder />
        <OverlayPublisher />
        <GamepadPushToTalk />
        <MuteKeybinds />
        <CallSounds />
        <E2eeNotices />
        <VoiceMoves />
      </RoomContext.Provider>
    </voiceContext.Provider>
  );
}

export const useVoice = () => useContext(voiceContext);
