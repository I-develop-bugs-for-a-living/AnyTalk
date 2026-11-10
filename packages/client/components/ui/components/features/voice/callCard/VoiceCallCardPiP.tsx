import {
  TrackLoop,
  TrackReference,
  useTrackRefContext,
  VideoTrack,
} from "solid-livekit-components";

import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";

import { VoiceCallCardActions } from "./VoiceCallCardActions";
import { VoiceCallCardStatus } from "./VoiceCallCardStatus";

/**
 * The floating call window: the stream or video the call window would show
 * (see `Voice.pipTrack`) with the call status and controls over it
 */
export function VoiceCallCardPiP() {
  return (
    <MiniCard data-mini-card>
      <VoiceCallCardStatus pip />
      <MiniVideoTile />
      <MiniActions>
        <VoiceCallCardActions size="xs" />
      </MiniActions>
    </MiniCard>
  );
}

/** Video of the track the floating window shows */
function MiniVideoTile() {
  const voice = useVoice();

  return (
    <TrackLoop
      tracks={() => {
        const track = voice.pipTrack();
        return track ? [track] : [];
      }}
    >
      {() => <MiniVideo />}
    </TrackLoop>
  );
}

/** Fills the card with the track from the surrounding track context */
function MiniVideo() {
  const track = useTrackRefContext();

  return (
    <VideoTrack
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        "border-radius": "inherit",
        "object-fit": "cover",
        overflow: "hidden",
      }}
      trackRef={track as TrackReference}
      manageSubscription={true}
    />
  );
}

/**
 * Holds the control bar of the mini tile. With a mouse the bar overlays the
 * bottom of the tile (no reflow) and only shows on hover or keyboard focus.
 * It stays in the tab order, so focusing a button reveals it. Touch devices
 * can't hover, so there the bar stays always visible in the normal flow.
 */
const MiniActions = styled("div", {
  base: {
    display: "contents",

    "@media (hover: hover)": {
      display: "flex",
      justifyContent: "center",
      position: "absolute",
      insetInline: "var(--gap-md)",
      insetBlockEnd: "var(--gap-md)",
      zIndex: 2,
      // let drags/clicks reach the tile around the bar
      pointerEvents: "none",

      opacity: 0,
      transition: "var(--transitions-fast) opacity",

      "@media (prefers-reduced-motion: reduce)": {
        transition: "none",
      },

      "& > *": { pointerEvents: "none" },

      "[data-mini-card]:hover > &, [data-mini-card]:focus-within > &": {
        opacity: 1,
        "& > *": { pointerEvents: "auto" },
      },
    },
  },
});

const MiniCard = styled("div", {
  base: {
    position: "relative",
    userSelect: "none",

    pointerEvents: "all",
    width: "100%",
    height: "100%",

    display: "flex",
    alignItems: "center",
    flexDirection: "column",
    justifyContent: "end",

    gap: "var(--gap-md)",
    padding: "var(--gap-md)",

    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-secondary-container)",
  },
});
