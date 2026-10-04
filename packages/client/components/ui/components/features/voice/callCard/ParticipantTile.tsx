import { createSignal, onCleanup, Show } from "solid-js";
import {
  TrackReference,
  useEnsureParticipant,
  useIsMuted,
  useIsSpeaking,
  useTrackRefContext,
  VideoTrack,
} from "solid-livekit-components";

import { Trans, useLingui } from "@lingui/solid/macro";
import { Track } from "livekit-client";
import { cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { UserContextMenu } from "@revolt/app";
import { useUser } from "@revolt/markdown/users";
import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { Avatar, IconButton } from "@revolt/ui/components/design";
import { Row } from "@revolt/ui/components/layout";
import { OverflowingText } from "@revolt/ui/components/utils";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { VoiceStatefulUserIcons } from "../VoiceStatefulUserIcons";

import { AudioStats } from "./AudioStats";
import { ConnectionQualityIcon } from "./ConnectionQualityIcon";
import { StreamVolumeButton } from "./StreamVolumeButton";
import { TrackStats } from "./TrackStats";

/**
 * Whether this window is focused and visible
 */
function useWindowFocused() {
  const check = () => document.hasFocus() && !document.hidden;
  const [focused, setFocused] = createSignal(check());
  const update = () => setFocused(check());

  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  document.addEventListener("visibilitychange", update);
  onCleanup(() => {
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", update);
    document.removeEventListener("visibilitychange", update);
  });

  return focused;
}

type TileProps = {
  focus?: boolean;
  /** Fill a cell of the multi-stream view */
  fill?: boolean;
};

/**
 * Individual participant tile
 */
export function ParticipantTile(props: TileProps) {
  const { t } = useLingui();
  const voice = useVoice();
  const state = useState();
  const participant = useEnsureParticipant();
  const track = useTrackRefContext();
  const user = useUser(participant.identity);

  let videoRef: HTMLVideoElement | undefined;

  const [videoDims, setVideoDims] = createSignal<{
    height: number;
    width: number;
  }>({ height: 0, width: 0 });

  const isRemoteScreenShareMuted = useIsMuted({
    participant,
    source: Track.Source.ScreenShare,
  });

  const isVideoMuted = useIsMuted({
    participant,
    source: Track.Source.Camera,
  });

  const isVideo = () => !isVideoMuted();
  const isScreenShare = () => track.source === Track.Source.ScreenShare;
  const isSpeaking = useIsSpeaking(participant);

  const theater = () => !!props.focus && voice.layout() === "fullscreen";
  // the call window isn't maximized, so its tiles are small
  const compact = () =>
    voice.layout() !== "expanded" && voice.layout() !== "fullscreen";

  // Our own screen share is hidden while we're elsewhere: it saves drawing the
  // preview and avoids a hall-of-mirrors when sharing this window's screen
  const windowFocused = useWindowFocused();
  const hideOwnStream = () =>
    isScreenShare() && participant.isLocal && !windowFocused();

  // Streams only play once we choose to watch them
  const unwatched = () => voice.isUnwatchedStream(track);

  const getHeight = () => {
    if (!props.focus || theater() || videoDims().height == 0) return {};
    // Calculate the aspect ratio
    const ratio = videoDims().width / videoDims().height;

    return ratio > 1
      ? { height: `min(var(--vc-w) / ${ratio}, 100%)` }
      : { height: "100%" };
  };

  return (
    <Show when={!isScreenShare() || !isRemoteScreenShareMuted()}>
      <div
        class={
          tile({
            // a stream stands in for its streamer's tile until it's watched
            speaking: (!isScreenShare() || unwatched()) && isSpeaking(),
            video: isVideo() || isScreenShare(),
            fullscreen: voice.layout() === "fullscreen",
            ...props,
            theater: theater(),
          }) + (isScreenShare() ? " vc_tile group" : " vc_tile")
        }
        onClick={() => {
          if (isScreenShare() && !voice.isWatchedStream(track)) {
            // open the stream (our own one too, once it's out of view)
            voice.watchStream(participant.identity);
          } else if (!props.fill && !(theater() && touchOnly())) {
            // in the full screen stream a tap only shows the controls
            voice.toggleFocus(track);
          }
        }}
        use:floating={{
          // TODO: Conflicts with focusing, maybe only show if clicking name itself
          //   userCard: {
          //     user: user().user!,
          //     member: user().member,
          //   },
          contextMenu: () => (
            <UserContextMenu
              user={user().user!}
              member={user().member}
              inVoice={!isScreenShare()}
              isScreenshare={isScreenShare()}
            />
          ),
        }}
        style={{ ...getHeight() }}
      >
        <Show
          when={isVideo() || isScreenShare()}
          fallback={
            <AvatarOnly compact={compact()}>
              <Avatar
                src={user().avatar}
                fallback={user().username}
                size={48}
                interactive={false}
              />
            </AvatarOnly>
          }
        >
          <Show
            when={!unwatched()}
            fallback={
              <StreamInvite>
                <Avatar
                  src={user().avatar}
                  fallback={user().username}
                  size={48}
                  interactive={false}
                />
                <Row gap="sm" align>
                  <LiveBadge>
                    <Trans>LIVE</Trans>
                  </LiveBadge>
                  <OverflowingText>{user().username}</OverflowingText>
                </Row>
                <WatchButton>
                  <Symbol size={18}>play_arrow</Symbol>
                  <Trans>Watch stream</Trans>
                </WatchButton>
              </StreamInvite>
            }
          >
            <Show
              when={!hideOwnStream()}
              fallback={
                <OwnStreamHidden>
                  <Trans>Stream is still running.</Trans>
                </OwnStreamHidden>
              }
            >
              <VideoTrack
                style={{
                  "grid-area": "1/1",
                  "object-fit": "contain",
                  width: "100%",
                  height: "100%",
                  overflow: "hidden",
                }}
                trackRef={track as TrackReference}
                manageSubscription={true}
                ref={videoRef}
                on:resize={() => {
                  setVideoDims({
                    height: videoRef?.videoHeight || 0,
                    width: videoRef?.videoWidth || 0,
                  });
                }}
              />
            </Show>
          </Show>
        </Show>
        <Show
          when={
            (isVideo() || isScreenShare()) &&
            !unwatched() &&
            state.settings.getValue("advanced:developer_mode") &&
            state.settings.getValue("advanced:developer_overlay")
          }
        >
          <TrackStats />
        </Show>
        {/* the multi-stream view puts its close button where this goes */}
        <Show
          when={
            !props.fill &&
            state.settings.getValue("advanced:developer_voice") &&
            state.settings.getValue("advanced:developer_voice_overlay")
          }
        >
          <AudioStats />
        </Show>
        <Show when={props.fill}>
          <CloseStream onClick={(e) => e.stopPropagation()}>
            <IconButton
              size="xs"
              variant="tonal"
              onPress={() => voice.leaveStream(participant.identity)}
              use:floating={{
                tooltip: { placement: "left", content: t`Close stream` },
              }}
            >
              <Symbol>close</Symbol>
            </IconButton>
          </CloseStream>
        </Show>
        {/* In fullscreen the name moves to the floating call controls */}
        <Show when={!theater()}>
          <Overlay
            showOnHover={isScreenShare() && !unwatched()}
            compact={compact()}
          >
            <ParticipantInfo nameOnly={compact()} />
          </Overlay>
        </Show>
      </div>
    </Show>
  );
}

/**
 * Whether the device has no mouse to hover with, e.g. phones
 */
export const touchOnly = () => !matchMedia("(hover: hover)").matches;

/**
 * Name and audio state of the participant in the current track context
 */
export function ParticipantInfo(props: {
  /** Which edge the stream volume slider lines up with */
  align?: "start" | "end";
  /** Leave out the icons, e.g. for the small tiles of a call window */
  nameOnly?: boolean;
  /** Only the stream volume, e.g. in the crowded controls on phones */
  controlsOnly?: boolean;
}) {
  const state = useState();
  const participant = useEnsureParticipant();
  const track = useTrackRefContext();
  const user = useUser(participant.identity);

  const isMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });

  const isScreenShareAudioMuted = useIsMuted({
    participant,
    source: Track.Source.ScreenShareAudio,
  });

  const isVideoMuted = useIsMuted({
    participant,
    source: Track.Source.Camera,
  });

  const isScreenShare = () => track.source === Track.Source.ScreenShare;

  const isScreenShareAudioUserMuted = () =>
    !user().user!.self && state.voice.getScreenShareMuted(user().user!.id)
      ? "by-user"
      : isScreenShareAudioMuted() || false;

  return (
    <OverlayInner>
      <Show when={!props.controlsOnly}>
        <OverflowingText>{user().username}</OverflowingText>
      </Show>
      <Show when={!props.nameOnly}>
        <Row gap="md">
          <Show when={!props.controlsOnly}>
            <ConnectionQualityIcon />
          </Show>
          {/* the stream replaces the streamer's own tile, so keep their mic state */}
          <Show when={isScreenShare() && !props.controlsOnly}>
            <VoiceStatefulUserIcons
              userId={participant.identity}
              muted={isMuted()}
            />
          </Show>
          {isScreenShare() && !user().user!.self ? (
            <StreamVolumeButton
              userId={participant.identity}
              noAudio={isScreenShareAudioMuted()}
              align={props.align}
            />
          ) : isScreenShare() ? (
            <Show when={isScreenShareAudioUserMuted()}>
              <Symbol
                size={18}
                color={
                  isScreenShareAudioUserMuted() === "by-user"
                    ? "var(--md-sys-color-error)"
                    : undefined
                }
              >
                no_sound
              </Symbol>
            </Show>
          ) : (
            <Show when={!props.controlsOnly}>
              <VoiceStatefulUserIcons
                userId={participant.identity}
                muted={isMuted()}
                camera={!isVideoMuted()}
              />
            </Show>
          )}
        </Row>
      </Show>
    </OverlayInner>
  );
}

export const tile = cva({
  base: {
    display: "grid",
    aspectRatio: "16/9",
    transition: "all .3s ease, width 0s, height 0s",
    borderRadius: "var(--borderRadius-lg)",
    width: "var(--vc-tile-width)",
    maxWidth: "calc(var(--vc-h) * 16 / 9)",
    cursor: "pointer",

    color: "var(--md-sys-color-on-surface)",
    background: "#0002",

    overflow: "hidden",
    outlineWidth: "3px",
    outlineStyle: "solid",
    outlineOffset: "-3px",
    outlineColor: "transparent",
  },
  variants: {
    speaking: {
      true: {
        outlineColor: "var(--md-sys-color-primary)",
      },
    },
    focus: {
      true: {
        width: "auto",
        maxWidth: "none",
      },
    },
    fill: {
      true: {
        flex: "1 1 0",
        minWidth: 0,
        width: "auto",
        height: "100%",
        maxWidth: "none",
        aspectRatio: "auto",
        cursor: "default",
        background: "black",
      },
    },
    video: {
      true: {},
    },
    fullscreen: {
      true: {
        minWidth: "20%",
      },
    },
    theater: {
      true: {
        width: "100%",
        height: "100%",
        borderRadius: 0,
        background: "black",
        outlineColor: "transparent",
      },
    },
  },
  compoundVariants: [
    {
      video: [false],
      focus: [true],
      css: {
        height: "100%",
        maxHeight: "calc(var(--vc-w) * 9 / 16)",
      },
    },
    {
      video: [true],
      focus: [true],
      css: {
        aspectRatio: "auto",
      },
    },
  ],
});

const AvatarOnly = styled("div", {
  base: {
    gridArea: "1/1",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    // leave room for the name overlay at the bottom
    paddingBottom: "40px",

    // TODO: Refactor the avatar component to be reactive later.
    "& > *": {
      width: "auto !important",
      height: "30% !important",
      // never taller than the room above the name, e.g. in small tiles
      minHeight: "min(48px, 100%)",
    },
  },
  variants: {
    compact: {
      // scale with the tile and stay clear of the name below
      true: {
        paddingBottom: "18px",

        "& > *": {
          height: "50% !important",
          minHeight: 0,
        },
      },
    },
  },
});

const Overlay = styled("div", {
  base: {
    minWidth: 0,
    gridArea: "1/1",

    padding: "var(--gap-md) var(--gap-lg)",

    opacity: 1,
    display: "flex",
    alignItems: "end",
    flexDirection: "row",

    transition: "var(--transitions-fast) all",
    transitionTimingFunction: "ease",
  },
  variants: {
    showOnHover: {
      true: {
        opacity: 0,

        _groupHover: {
          opacity: 1,
        },
      },
      false: {
        opacity: 1,
      },
    },
    compact: {
      true: {
        padding: "var(--gap-xs) var(--gap-sm)",
        fontSize: "12px",

        "& > *": {
          justifyContent: "center",
        },
      },
    },
  },
  defaultVariants: {
    showOnHover: false,
  },
});

const OverlayInner = styled("div", {
  base: {
    minWidth: 0,

    display: "flex",
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",

    _first: {
      flexGrow: 1,
    },
  },
});

const OwnStreamHidden = styled("div", {
  base: {
    gridArea: "1/1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--gap-md)",
    textAlign: "center",
    background: "#000",
    color: "#fff",
  },
});

const StreamInvite = styled("div", {
  base: {
    gridArea: "1/1",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--gap-sm)",
    padding: "var(--gap-md)",
    // leave room for the name overlay at the bottom
    paddingBottom: "40px",
    fontWeight: 600,
  },
});

const LiveBadge = styled("span", {
  base: {
    flexShrink: 0,
    paddingInline: "6px",
    borderRadius: "var(--borderRadius-sm)",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    background: "var(--md-sys-color-error)",
    color: "var(--md-sys-color-on-error)",
  },
});

const WatchButton = styled("span", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-xs)",
    paddingBlock: "var(--gap-xs)",
    paddingInline: "var(--gap-md)",
    borderRadius: "var(--borderRadius-full)",
    fontSize: "13px",
    background: "var(--md-sys-color-primary)",
    color: "var(--md-sys-color-on-primary)",
  },
});

const CloseStream = styled("div", {
  base: {
    gridArea: "1/1",
    justifySelf: "end",
    alignSelf: "start",
    zIndex: 1,
    padding: "var(--gap-sm)",
    opacity: 0,
    transition: "var(--transitions-fast) opacity",
    _groupHover: { opacity: 1 },
  },
});
