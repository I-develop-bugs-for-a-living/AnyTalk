import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import {
  TrackReference,
  useEnsureParticipant,
  useIsMuted,
  useTrackRefContext,
  VideoTrack,
} from "solid-livekit-components";

import { Trans, useLingui } from "@lingui/solid/macro";
import { Track } from "livekit-client";
import { cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { UserContextMenu } from "@revolt/app";
import { useUser } from "@revolt/markdown/users";
import { useFastIsSpeaking, useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import {
  Avatar,
  Button,
  IconButton,
  useSnackbar,
} from "@revolt/ui/components/design";
import { Row } from "@revolt/ui/components/layout";
import { OverflowingText } from "@revolt/ui/components/utils";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { VoiceStatefulUserIcons } from "../VoiceStatefulUserIcons";

import { AudioStats } from "./AudioStats";
import { ConnectionQualityIcon } from "./ConnectionQualityIcon";
import { StreamViewerBadge } from "./StreamViewerBadge";
import { StreamVolumeButton } from "./StreamVolumeButton";
import { TrackStats } from "./TrackStats";
import { theaterControlsHidden, touchOnly } from "./volumePanelState";

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
  const snackbar = useSnackbar();
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
  const isSpeaking = useFastIsSpeaking(participant);

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

  // Shown in a window of its own: this window doesn't draw the video then
  const poppedOut = () => voice.isPoppedOut(track);
  // Popping out is for devices with a mouse (touch-only devices get no button,
  // see Voice.popoutKind). Our own screen share stays here, in its own window it would mirror itself
  const canPopOut = () =>
    !!voice.popoutKind &&
    !poppedOut() &&
    (isScreenShare()
      ? !participant.isLocal && !unwatched()
      : isVideo() && !isVideoMuted());

  /** Open the stream in its own window, tell the user when that fails */
  const popOut = async () => {
    const opened = await voice.popOut(
      track,
      t`${user().username} – AnyTalk`,
      videoDims().width ? videoDims() : undefined,
    );
    if (!opened) {
      snackbar.show({
        // only a popup can be blocked, Picture-in-Picture just fails
        message:
          voice.popoutKind === "popup"
            ? t`Could not open the stream in a separate window. Check that pop-ups are allowed.`
            : t`Could not open the stream in a separate window.`,
      });
    }
  };

  // Multi-stream view: this tile fills the whole stream area, the other tiles
  // stay mounted (and subscribed) underneath it
  const multiFocused = createMemo(() => !!voice.multiFocusTrack());
  const enlarged = () => !!props.fill && multiFocused() && voice.isFocus(track);
  const covered = () => !!props.fill && multiFocused() && !enlarged();

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
            enlarged: enlarged(),
          }) + " vc_tile group"
        }
        data-stream-tile={props.fill ? "" : undefined}
        aria-pressed={props.fill ? enlarged() : undefined}
        // out of reach while covered, so keyboard and screen readers skip it
        inert={covered()}
        // reachable by keyboard: Enter / Space act like a click, Shift+F10
        // opens the context menu. Known limitation: the tile also holds its
        // own buttons (stream controls), so screen readers see nested
        // interactive elements; the name comes from the tile's content.
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          // keys on buttons inside the tile are theirs
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.currentTarget.click();
          }
        }}
        onClick={() => {
          if (isScreenShare() && !voice.isWatchedStream(track)) {
            // open the stream (our own one too, once it's out of view)
            voice.watchStream(participant.identity);
          } else if (props.fill) {
            // multi-stream view: enlarge this stream or go back to the grid.
            // On touch in the full screen view a tap first shows the hidden
            // controls (the call card handles that tap), then toggles
            if (!(touchOnly() && theaterControlsHidden())) {
              voice.toggleMultiFocus(track);
            }
          } else if (!(theater() && touchOnly())) {
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
            <Show when={poppedOut()}>
              <PoppedOut onClick={(e) => e.stopPropagation()}>
                <Trans>Showing in a separate window</Trans>
                <Button
                  size="sm"
                  variant="tonal"
                  onPress={() => voice.closePopout(voice.trackId(track))}
                >
                  <Trans>Bring back</Trans>
                </Button>
              </PoppedOut>
            </Show>
            {/* The video stays mounted while hidden so the tile keeps its size.
                A popped out stream is drawn in its own window instead. */}
            <Show when={!poppedOut()}>
              <VideoTrack
                style={{
                  "grid-area": "1/1",
                  "object-fit": "contain",
                  width: "100%",
                  height: "100%",
                  overflow: "hidden",
                  visibility: hideOwnStream() ? "hidden" : "visible",
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
            <Show when={hideOwnStream()}>
              <OwnStreamHidden role="status">
                <Trans>Stream is still running.</Trans>
              </OwnStreamHidden>
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
        {/* who watches this stream, never over the close button side */}
        <Show when={isScreenShare() && !unwatched()}>
          <StreamViewerBadge streamer={participant.identity} />
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
        {/* Always visible, above the name row so it never covers the volume button */}
        <Show when={canPopOut()}>
          <PopOutSlot
            // a click here must not focus or enlarge the tile
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            clearOverlay={!theater()}
            compact={compact()}
          >
            <PopOutButton
              type="button"
              aria-label={t`Pop out into a separate window`}
              onClick={popOut}
              use:floating={{
                tooltip: {
                  placement: "top",
                  content: t`Pop out into a separate window`,
                },
              }}
            >
              <Symbol size={18}>pip</Symbol>
            </PopOutButton>
          </PopOutSlot>
        </Show>
        {/* In fullscreen the name moves to the floating call controls */}
        <Show when={!theater()}>
          <Overlay
            // touch has no hover, there the volume button must always be in reach
            showOnHover={isScreenShare() && !unwatched() && !touchOnly()}
            compact={compact()}
          >
            <ParticipantInfo compact={compact()} />
          </Overlay>
        </Show>
      </div>
    </Show>
  );
}

/**
 * Name and audio state of the participant in the current track context.
 *
 * Laid out the same in every call view: the name with the connection and mic
 * state right after it on the start side, the volume button at the far end.
 */
export function ParticipantInfo(props: {
  /** Which edge the stream volume slider lines up with */
  align?: "start" | "end";
  /** Smaller icons for the small tiles of a call window */
  compact?: boolean;
  /**
   * Only part of it: the name and states, or the volume button. The theater
   * puts the two in different places of its control bar.
   */
  part?: "all" | "info" | "volume";
}) {
  const state = useState();
  const voice = useVoice();
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
  const unwatched = () => voice.isUnwatchedStream(track);
  // an unwatched stream stands in for its streamer's voice tile
  const voiceKind = () => !isScreenShare() || unwatched();
  const showInfo = () => props.part !== "volume";
  const showVolume = () => props.part !== "info";

  const isScreenShareAudioUserMuted = () =>
    !user().user!.self && state.voice.getScreenShareMuted(user().user!.id)
      ? "by-user"
      : isScreenShareAudioMuted() || false;

  return (
    <OverlayInner>
      <Show when={showInfo()}>
        <InfoGroup compact={props.compact}>
          <OverflowingText>{user().username}</OverflowingText>
          <States compact={props.compact}>
            <ConnectionQualityIcon />
            {/* the stream replaces the streamer's own tile, so keep their mic state */}
            <Show when={isScreenShare()}>
              <VoiceStatefulUserIcons
                userId={participant.identity}
                muted={isMuted()}
              />
            </Show>
            <Show when={!isScreenShare()}>
              <VoiceStatefulUserIcons
                userId={participant.identity}
                muted={isMuted()}
                camera={!isVideoMuted()}
              />
            </Show>
            <Show
              when={
                user().user!.self &&
                isScreenShare() &&
                isScreenShareAudioUserMuted()
              }
            >
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
          </States>
        </InfoGroup>
      </Show>
      <Show when={showVolume() && !user().user!.self}>
        <VolumeSlot hoverOnly={voiceKind() && props.part !== "volume"}>
          {/* an unwatched stream stands in for its streamer's voice tile */}
          <StreamVolumeButton
            userId={participant.identity}
            kind={voiceKind() ? "voice" : "stream"}
            noAudio={isScreenShareAudioMuted()}
            align={props.align}
            compact={props.compact}
          />
        </VolumeSlot>
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

    // keyboard focus: the inner band tells it apart from the speaking ring
    _focusVisible: {
      outlineColor: "var(--md-sys-color-primary)",
      boxShadow: "inset 0 0 0 5px var(--md-sys-color-on-primary)",
    },
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
        background: "black",
      },
    },
    // fills the stream area of the multi-stream view, over the other tiles
    enlarged: {
      true: {
        position: "absolute",
        inset: 0,
        zIndex: 1,
        width: "100%",
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

/** Name and states on the start side, the name shrinks first */
const InfoGroup = styled("div", {
  base: {
    flex: "1 1 0",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: "8px",
  },
  variants: {
    compact: {
      true: { gap: "4px" },
    },
  },
});

/** Connection and mic icons, never squeezed by a long name */
const States = styled("div", {
  base: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  variants: {
    compact: {
      true: { gap: "4px" },
    },
  },
});

/** The volume button at the far end */
const VolumeSlot = styled("div", {
  base: {
    flexShrink: 0,
    marginInlineStart: "auto",
    paddingInlineStart: "4px",
    display: "flex",
  },
  variants: {
    // desktop only: a voice volume button on the tile shows on hover, focus
    // or while its panel is open (touch has no hover and always shows it)
    hoverOnly: {
      true: {
        "@media (hover: hover)": {
          opacity: 0,
          transition: "var(--transitions-fast) opacity",
          _groupHover: { opacity: 1 },
          _groupFocusWithin: { opacity: 1 },
          "&:has([data-open])": { opacity: 1 },
        },
      },
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
    // sits above the hidden video that keeps the tile's size
    zIndex: 1,
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

/**
 * Placeholder of a stream that is shown in a window of its own. It stands in
 * for the video area, so it keeps the video's black.
 */
const PoppedOut = styled("div", {
  base: {
    gridArea: "1/1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--gap-md)",
    padding: "var(--gap-md)",
    textAlign: "center",
    background: "black",
    color: "var(--md-sys-color-inverse-on-surface, white)",
  },
});

/** Bottom corner of a tile (end side), clear of the name row when it shows */
const PopOutSlot = styled("div", {
  base: {
    gridArea: "1/1",
    justifySelf: "end",
    alignSelf: "end",
    zIndex: 1,
    padding: "var(--gap-sm)",
  },
  variants: {
    clearOverlay: { true: { marginBlockEnd: "40px" } },
    compact: { true: {} },
  },
  compoundVariants: [
    { clearOverlay: true, compact: true, css: { marginBlockEnd: "20px" } },
  ],
});

/** Small round button on a translucent dark background */
const PopOutButton = styled("button", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    padding: 0,
    border: "none",
    borderRadius: "var(--borderRadius-full)",
    cursor: "pointer",
    background: "rgb(0 0 0 / 0.55)",
    color: "white",

    _hover: { background: "rgb(0 0 0 / 0.75)" },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

/** Buttons in the top corner of a tile, shown on hover */
const CloseStream = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-xs)",
    gridArea: "1/1",
    justifySelf: "end",
    alignSelf: "start",
    zIndex: 1,
    padding: "var(--gap-sm)",
    opacity: 0,
    transition: "var(--transitions-fast) opacity",
    _groupHover: { opacity: 1 },
    _focusWithin: { opacity: 1 },
  },
});
