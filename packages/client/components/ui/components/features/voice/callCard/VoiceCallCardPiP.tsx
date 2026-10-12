import { Show } from "solid-js";
import {
  TrackLoop,
  TrackReference,
  useEnsureParticipant,
  useIsMuted,
  useTrackRefContext,
  useTracks,
  VideoTrack,
} from "solid-livekit-components";

import { Track } from "livekit-client";
import { styled } from "styled-system/jsx";

import { useUser } from "@revolt/markdown/users";
import { useFastIsSpeaking, useVoice } from "@revolt/rtc";
import { Avatar } from "@revolt/ui/components/design";
import { Row } from "@revolt/ui/components/layout";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { VoiceCallCardActions } from "./VoiceCallCardActions";
import { VoiceCallCardStatus } from "./VoiceCallCardStatus";

export function VoiceCallCardPiP() {
  const voice = useVoice();
  const audTracks = useTracks(
    [{ source: Track.Source.Microphone, withPlaceholder: true }],
    { onlySubscribed: false },
  );

  const hasFocusVideo = () => {
    const track = voice.focusTrack();
    if (!track) return false;

    return (
      track.source === Track.Source.ScreenShare ||
      !useIsMuted({
        participant: track.participant,
        source: Track.Source.Camera,
      })()
    );
  };

  return (
    <MiniCard data-mini-card>
      <VoiceCallCardStatus pip />
      <Show when={!hasFocusVideo()} fallback={<MiniVideoTile />}>
        <Row align justify grow wrap>
          <TrackLoop tracks={audTracks}>{() => <ConnectedUser />}</TrackLoop>
        </Row>
      </Show>
      <MiniActions>
        <VoiceCallCardActions size="xs" />
      </MiniActions>
    </MiniCard>
  );
}

function ConnectedUser() {
  const participant = useEnsureParticipant();

  const isMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });

  const isSpeaking = useFastIsSpeaking(participant);
  const user = useUser(participant.identity);

  return (
    <UserIcon speaking={isSpeaking()}>
      <Avatar
        size={24}
        src={user().avatar}
        fallback={user().username}
        shape="square"
      />
      <Show when={isMuted()}>
        <Symbol background="rgba(0,0,0,.5)">mic_off</Symbol>
      </Show>
    </UserIcon>
  );
}

function MiniVideoTile() {
  const voice = useVoice();

  return (
    <TrackLoop tracks={() => [voice.focusTrack()!]}>
      {() => <MiniVideo />}
    </TrackLoop>
  );
}

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

const UserIcon = styled("div", {
  base: {
    display: "grid",
    width: "24px",
    height: "24px",
    color: "#fffb",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-circle)",

    "& *": {
      gridArea: "1/1",
    },
  },
  variants: {
    speaking: {
      true: {
        outlineOffset: "1px",
        outline: "2px solid var(--md-sys-color-primary)",
      },
    },
  },
});

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
