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

import { ReactiveSet } from "@solid-primitives/set";
import {
  AudioPresets,
  LocalTrackPublication,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  ScreenShareCaptureOptions,
  ScreenSharePresets,
  Track,
  TrackEvent,
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
  ScreenShareResolution,
  ScreenShareResolutions,
  Voice as VoiceSettings,
} from "@revolt/state/stores/Voice";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { Device, useDevice } from "@revolt/common";
import { setCallAudioSession } from "./audioSession";
import { CallSounds } from "./components/CallSounds";
import { InRoom } from "./components/InRoom";
import { RoomAudioManager } from "./components/RoomAudioManager";
import { StatsRecorder } from "./components/StatsRecorder";
import { VoiceKeybinds } from "./components/VoiceKeybinds";
import { VoiceMoves } from "./components/VoiceMoves";
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

/**
 * How long join and leave sounds wait for a move event of the same person,
 * so a move only plays the moved sound
 */
const MOVE_GRACE_MS = 750;

class Voice {
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

  /** Participant whose stream should be focused once its tile shows up */
  pendingFocus: Accessor<string | undefined>;
  #setPendingFocus: Setter<string | undefined>;

  private sound: SoundController;
  private device: Device;

  private openModal;
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

    const [pendingFocus, setPendingFocus] = createSignal<string>();
    this.pendingFocus = pendingFocus;
    this.#setPendingFocus = setPendingFocus;

    const inst = useInstance();
    this.config = inst.config;
    this.limits = inst.limits;
    this.openModal = modals.openModal;

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
    this.disconnect();

    this.device.setWakeLocked();

    const room = new Room({
      // Only receive video at the size it is displayed, and pause it when hidden
      adaptiveStream: true,
      // Stop sending simulcast layers that nobody is subscribed to
      dynacast: true,
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
      this.#setState("CONNECTING");
      this.#setVideo(false);
      this.#setScreenshare(false);
    });

    room.addListener("connected", () => {
      this.#setState("CONNECTED");
      if (this.speakingPermission)
        this.#setMicrophoneEnabled(room, this.#settings.micOn).then((track) => {
          this.#settings.micOn = track != null;
        });
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

    room.addListener("disconnected", () => {
      setCallAudioSession(false);
      this.#setState("DISCONNECTED");
    });

    room.addListener("localTrackPublished", (pub) => {
      if (pub.audioTrack && pub.audioTrack.source === Track.Source.Microphone) {
        if (!pub.audioTrack.getProcessor()) {
          pub.audioTrack
            ?.setProcessor(
              (this.voiceProcessor = new VoiceProcessor(
                this.#settings,
                this.#setMicBlocked,
              )),
            )
            // without it the unprocessed microphone is sent, which still works
            ?.catch((err) =>
              console.error("[rtc] could not set up voice processing", err),
            );
        }
      }
    });

    room.addListener("participantConnected", (participant) => {
      this.#announce(room, participant.identity, "userJoinVoice");
    });

    room.addListener("participantDisconnected", (participant) => {
      this.#announce(room, participant.identity, "userLeaveVoice");
      this.watching.delete(participant.identity);
    });

    room.addListener("trackPublished", (pub) => {
      // streams aren't watched automatically, so announce them right away
      if (pub.source === Track.Source.ScreenShare) {
        this.sound.playSound("streamStart");
        this.screenShareTracks.add(pub.trackSid);
      }
    });

    room.addListener("localTrackUnpublished", (unpub) => {
      if (unpub.source === Track.Source.ScreenShare) {
        this.watching.delete(room.localParticipant.identity);
      }
    });

    room.addListener("trackUnpublished", (unpub, participant) => {
      if (this.screenShareTracks.has(unpub.trackSid)) {
        this.sound.playSound("streamEnd");
        this.screenShareTracks.delete(unpub.trackSid);
      }
      if (unpub.source === Track.Source.ScreenShare) {
        this.watching.delete(participant.identity);
      }
    });

    // Gather latency
    const selected = await Promise.any(
      this.config.features.livekit.nodes.map(async (node) => {
        return fetch(node.public_url.replace("wss", "https")).then(() => {
          return node.name;
        });
      }),
    );

    if (!auth) {
      auth = await channel.joinCall(selected);
    }

    await room.connect(auth.url, auth.token, {
      autoSubscribe: false,
    });
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
   * Retry starting call audio, must be called from a user gesture
   */
  startAudio() {
    this.voiceProcessor?.resume();
    this.room()
      ?.startAudio()
      .catch(() => {})
      .finally(() => this.#setPlaybackBlocked(!this.room()?.canPlaybackAudio));
  }

  disconnect() {
    this.device.releaseWakeLock();
    setCallAudioSession(false);
    this.#releaseAudioUnlock?.();
    this.#releaseAudioUnlock = undefined;
    try {
      const room = this.room();
      if (!room) return;

      room.removeAllListeners();
      room.disconnect();

      batch(() => {
        this.#setState("READY");
        this.#setRoom();
        this.#setChannel();
        this.#setLayout();
        this.vidTracks = () => [];
      });

      this.screenShareTracks = new Set();
      this.watching.clear();
      this.#setPendingFocus();

      this.sound.playSound("userLeaveVoice");
    } catch (e) {
      this.onErr(e);
    }
  }

  /**
   * Turn the microphone on or off, switching iOS to call audio before it
   * opens. Muting keeps the microphone open, so call audio stays on until
   * there is no microphone track any more (e.g. turning it on failed).
   * @param room Room
   * @param enabled Whether the microphone should be on
   * @returns Microphone track publication, if any
   */
  async #setMicrophoneEnabled(room: Room, enabled: boolean) {
    if (enabled) setCallAudioSession(true);
    try {
      return await room.localParticipant.setMicrophoneEnabled(enabled);
    } finally {
      setCallAudioSession(
        !!room.localParticipant.getTrackPublication(Track.Source.Microphone),
      );
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
      await this.#setMicrophoneEnabled(
        room,
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
      await this.#setMicrophoneEnabled(
        room,
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

  async toggleScreenshare() {
    const room = this.room();
    if (!room) throw "invalid state";

    if (this.screenshare()) {
      await room.localParticipant.setScreenShareEnabled(false);

      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);

      this.sound.playSound("streamEnd");
    } else {
      const resolutions = this.getEnabledScreenShareResolutions().map(
        (value) => ({ value, label: SCREEN_SHARE_RESOLUTION_LABELS[value] }),
      );
      let screenPicked:
        | {
            resolution: ScreenShareResolution;
            frameRate: ScreenShareFrameRate;
            audio: boolean;
          }
        | undefined;

      // Register the modal on screen picker handler if it exists
      if (window.native && window.native.onceScreenPicker) {
        window.native.onceScreenPicker((sources) => {
          this.openModal({
            type: "screen_share_picker",
            onCancel: () => {
              window.native.screenPickerCallback(-1, false);
            },
            callback: (idx, resolution, frameRate, audio) => {
              window.native.screenPickerCallback(idx, audio);
              screenPicked = { resolution, frameRate, audio };
            },
            sources: sources,
            resolutions,
          });
        });
      }

      try {
        const chosenQuality = this.#screenShareQuality(
          this.#settings.screenShareResolution,
          this.#settings.screenShareFrameRate,
        );
        const localTrack = await room.localParticipant.setScreenShareEnabled(
          true,
          {
            resolution: chosenQuality?.resolution,
            audio: {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              voiceIsolation: false,
              restrictOwnAudio: true,
            },
          },
          {
            screenShareEncoding: chosenQuality?.encoding,
            // Send only the full-size stream: a half-size simulcast copy makes
            // shared text unreadable for viewers showing the stream small
            simulcast: false,
            // Stream audio is music and video sound rather than speech: send
            // it in stereo at a music bitrate, and keep sending it through
            // silence (DTX nearly stops sending while it's quiet)
            audioPreset: AudioPresets.musicHighQualityStereo,
            forceStereo: true,
            dtx: false,
            red: false,
          },
        );

        const screenAudioTrack = room.localParticipant.getTrackPublication(
          Track.Source.ScreenShareAudio,
        );

        this.#setScreenshare(room.localParticipant.isScreenShareEnabled);

        // During quiet parts the browser can report the captured audio as
        // muted, LiveKit then stops sending it until the capture reports
        // sound again, which might never happen. Only we pause stream audio.
        let holdScreenAudio = false;
        const screenAudio = screenAudioTrack?.track;
        screenAudio?.on(TrackEvent.UpstreamPaused, () => {
          if (!holdScreenAudio) screenAudio.resumeUpstream();
        });

        if (localTrack) {
          // This event is only fired if the screen share is ended by closing the window being streamed.
          // This catches the ending and disables screen sharing on our side. If this weren't here,
          // livekit would still share stream audio after closing the window being streamed.
          localTrack.on("ended", () => {
            this.toggleScreenshare();
            const oldAudioTrack = room.localParticipant.getTrackPublication(
              Track.Source.ScreenShareAudio,
            );
            if (oldAudioTrack && oldAudioTrack.track) {
              room.localParticipant.unpublishTrack(oldAudioTrack.track);
            }
          });

          const callback = async (
            resolution: ScreenShareResolution,
            frameRate: ScreenShareFrameRate,
            audio: boolean,
          ) => {
            if (localTrack.videoTrack) {
              const quality = this.#screenShareQuality(
                resolution,
                frameRate,
                localTrack.videoTrack.mediaStreamTrack,
              );

              await localTrack.videoTrack.applyScreenShareConstraints(
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
              if (!audio && screenAudioTrack?.track) {
                room.localParticipant.unpublishTrack(screenAudioTrack.track);
              }
              this.sound.playSound("streamStart");
            }
          };

          if (screenPicked) {
            callback(
              screenPicked.resolution,
              screenPicked.frameRate,
              screenPicked.audio,
            );
          } else if (this.#settings.screenShareQualityAsk) {
            localTrack.pauseUpstream();
            holdScreenAudio = true;
            screenAudioTrack?.pauseUpstream();
            this.openModal({
              onCancel: async () => {
                await room.localParticipant.setScreenShareEnabled(false);
                this.#setScreenshare(
                  room.localParticipant.isScreenShareEnabled,
                );
              },
              type: "screen_share_settings",
              trackReference: {
                participant: room.localParticipant,
                publication: localTrack,
                source: Track.Source.ScreenShare,
              },
              resolutions,
              audio: !!screenAudioTrack,
              callback: async (resolution, frameRate, audio) => {
                callback(resolution, frameRate, audio);
                localTrack.resumeUpstream();
                if (audio) {
                  holdScreenAudio = false;
                  screenAudioTrack?.resumeUpstream();
                }
              },
            });
          } else {
            // Not asking: apply the saved choice, otherwise the capture stays
            // at the low startup constraints from getDisplayMedia
            callback(
              this.#settings.screenShareResolution,
              this.#settings.screenShareFrameRate,
              this.#settings.screenShareAudio,
            );
          }
        }
      } catch (e) {
        this.onErr(e);
      }
    }
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
    const id = t ? this.trackId(t) : undefined;
    if (this.focusId() === id || this.vidTracks().length < 2) {
      this.#setFocus(undefined);
    } else {
      this.#focus(t!);
    }
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
   * Stop watching the given participant's stream, or every stream
   */
  leaveStream(identity?: string) {
    for (const id of identity ? [identity] : [...this.watching]) {
      this.#stopWatching(id);
    }

    // down to a single stream again: show it on its own
    if (this.watching.size === 1) {
      this.#setPendingFocus([...this.watching][0]);
    }
  }

  #stopWatching(identity: string) {
    this.watching.delete(identity);

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
        </InRoom>
        <StatsRecorder />
        <CallSounds />
        <VoiceMoves />
      </RoomContext.Provider>
    </voiceContext.Provider>
  );
}

export const useVoice = () => useContext(voiceContext);
