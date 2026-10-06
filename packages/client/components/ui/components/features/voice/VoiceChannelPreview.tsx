import { useNavigate } from "@solidjs/router";
import { For, Show, createSignal, onCleanup, splitProps } from "solid-js";
import {
  TrackLoop,
  useEnsureParticipant,
  useIsMuted,
  useTracks,
} from "solid-livekit-components";

import { Trans, useLingui } from "@lingui/solid/macro";
import { ParticipantEvent, Track } from "livekit-client";
import { Channel, VoiceParticipant } from "stoat.js";
import { cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { UserContextMenu } from "@revolt/app";
import { useDevice } from "@revolt/common";
import { useUser } from "@revolt/markdown/users";
import { InRoom, useFastIsSpeaking, useVoice } from "@revolt/rtc";

import { Avatar, Ripple, typography } from "../../design";
import { Row } from "../../layout";

import { VoiceStatefulUserIcons } from "./VoiceStatefulUserIcons";
import {
  VOICE_USER_DRAG_TYPE,
  canMoveFrom,
  setDraggedVoiceUser,
} from "./voiceMove";

/**
 * Render a preview of users (or the active participants) for a given channel
 *
 * Designed for the server sidebar to be below channels
 */
export function VoiceChannelPreview(props: { channel: Channel }) {
  return (
    <InRoom
      channelId={props.channel.id}
      fallback={<VariantPreview channel={props.channel} />}
    >
      <VariantLive channel={props.channel} />
    </InRoom>
  );
}

/**
 * Use API as the source of truth
 */
function VariantLive(props: { channel: Channel }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );

  const streams = useTracks(
    [{ source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false },
  );

  const isStreaming = (identity: string) =>
    streams().some((t) => t.participant.identity === identity);

  return (
    <Base>
      <TrackLoop tracks={tracks}>
        {() => (
          <ParticipantLive channel={props.channel} isStreaming={isStreaming} />
        )}
      </TrackLoop>
    </Base>
  );
}

/**
 * Use LiveKit as the source of truth
 */
function VariantPreview(props: { channel: Channel }) {
  return (
    <Show when={props.channel.voiceParticipants.size}>
      <Base>
        <For each={[...props.channel.voiceParticipants.values()]}>
          {(participant) => (
            <ParticipantPreview
              channel={props.channel}
              participant={participant}
            />
          )}
        </For>
      </Base>
    </Show>
  );
}

/**
 * Live variant of participant
 */
function ParticipantLive(props: {
  channel: Channel;
  isStreaming: (identity: string) => boolean;
}) {
  const participant = useEnsureParticipant();
  const voice = useVoice();
  const navigate = useNavigate();

  const isMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });

  const isSpeaking = useFastIsSpeaking(participant);

  // shared by clients as a participant attribute, see Voice#shareDeafen
  const [attributes, setAttributes] = createSignal(participant.attributes);
  const onAttributes = () => setAttributes({ ...participant.attributes });
  participant.on(ParticipantEvent.AttributesChanged, onAttributes);
  onCleanup(() =>
    participant.off(ParticipantEvent.AttributesChanged, onAttributes),
  );

  const isDeafened = () => {
    if (participant.isLocal) return voice.deafen();
    const shared = attributes().deafened;
    return shared !== undefined
      ? shared === "true"
      : props.channel.voiceParticipants
          .get(participant.identity)
          ?.isReceiving() === false;
  };

  return (
    <CommonUser
      channel={props.channel}
      userId={participant.identity}
      speaking={isSpeaking()}
      muted={isMuted()}
      deafened={isDeafened()}
      camera={false}
      screenshare={props.isStreaming(participant.identity)}
      onWatch={
        participant.isLocal
          ? undefined
          : () => {
              navigate(props.channel.path);
              voice.watchStream(participant.identity);
            }
      }
      isLive
    />
  );
}

/**
 * Preview variant of participant
 */
function ParticipantPreview(props: {
  channel: Channel;
  participant: VoiceParticipant;
}) {
  const voice = useVoice();
  const navigate = useNavigate();

  return (
    <CommonUser
      channel={props.channel}
      userId={props.participant.userId}
      speaking={false}
      muted={!props.participant.isPublishing()}
      deafened={!props.participant.isReceiving()}
      camera={props.participant.isCamera()}
      screenshare={props.participant.isScreensharing()}
      onWatch={() => {
        // join the call first, then open their stream
        const userId = props.participant.userId;
        navigate(props.channel.path);
        voice.connect(props.channel).then(() => voice.watchStream(userId));
      }}
    />
  );
}

/**
 * Use only the participant row as drag image: the browser may otherwise
 * snapshot the surrounding sidebar layer. Renders an opaque clone off-screen.
 * @param e Drag start event, fired on the row
 */
function setRowDragImage(e: DragEvent & { currentTarget: HTMLElement }) {
  const row = e.currentTarget;
  const rect = row.getBoundingClientRect();
  const clone = row.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.insetBlockStart = "-1000px";
  clone.style.insetInlineStart = "0";
  clone.style.width = `${rect.width}px`;
  clone.style.pointerEvents = "none";
  clone.style.background = "var(--md-sys-color-surface-container-high)";
  clone.style.borderRadius = "var(--borderRadius-md)";
  // the clone leaves the sidebar, so it no longer inherits its text style
  const style = getComputedStyle(row);
  clone.style.color = style.color;
  clone.style.font = style.font;
  clone.style.lineHeight = style.lineHeight;
  document.body.appendChild(clone);
  e.dataTransfer?.setDragImage(
    clone,
    e.clientX - rect.left,
    e.clientY - rect.top,
  );
  // the browser has captured the image by the next task
  setTimeout(() => clone.remove(), 0);
}

/**
 * Component used for both variants
 */
function CommonUser(props: {
  channel: Channel;
  userId: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screenshare: boolean;
  /** Open this user's stream; clicking them does this while they stream */
  onWatch?: () => void;
  isLive?: boolean;
}) {
  const [iconProps, rest] = splitProps(props, ["muted", "deafened", "camera"]);

  const user = useUser(() => rest.userId);

  const { t } = useLingui();
  const { isMobile } = useDevice();
  const canWatch = () => rest.screenshare && !!rest.onWatch;

  // drag people into another voice channel to move them (desktop only: phones
  // and keyboards use "Move to channel" in the user context menu)
  const canDrag = () => !isMobile && canMoveFrom(rest.channel);

  return (
    <div
      class={previewUser({ speaking: rest.speaking, watchable: canWatch() })}
      // reachable by keyboard: Enter / Space act like a click (opening the
      // profile card or the stream), Shift+F10 opens the context menu
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
      onClick={() => canWatch() && rest.onWatch!()}
      draggable={canDrag()}
      // the channel list's drag zones ignore presses here (see Draggable), so
      // they can't start reordering channels instead of this native drag
      data-no-reorder={canDrag() ? "" : undefined}
      onDragStart={(e) => {
        if (!canDrag() || !e.dataTransfer) return;
        e.stopPropagation();
        e.dataTransfer.setData(VOICE_USER_DRAG_TYPE, rest.userId);
        e.dataTransfer.effectAllowed = "move";
        setRowDragImage(e);
        setDraggedVoiceUser({ userId: rest.userId, from: rest.channel });
      }}
      onDragEnd={() => setDraggedVoiceUser(undefined)}
      use:floating={{
        // while streaming, a click opens the stream instead
        userCard: canWatch()
          ? undefined
          : {
              user: user().user!,
              member: user().member,
            },
        contextMenu: () => (
          <UserContextMenu
            user={user().user!}
            member={user().member}
            inVoice={rest.isLive}
          />
        ),
      }}
    >
      <Ripple />
      <Avatar size={24} src={user().avatar} fallback={user().username} />{" "}
      <PreviewUsername>{user().username}</PreviewUsername>
      <Row gap="sm" align>
        <VoiceStatefulUserIcons {...iconProps} userId={rest.userId} />
        <Show when={rest.screenshare}>
          <LiveBadge
            use:floating={{
              tooltip: canWatch()
                ? { placement: "top", content: t`Watch stream` }
                : undefined,
            }}
          >
            <Trans>LIVE</Trans>
          </LiveBadge>
        </Show>
      </Row>
    </div>
  );
}

const Base = styled("div", {
  base: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",

    marginBlock: "var(--gap-sm)",
    marginInlineStart: "var(--gap-xl)",
    marginInlineEnd: "var(--gap-md)",

    color: "var(--md-sys-color-outline)",

    borderRadius: "var(--borderRadius-md)",
  },
});

const previewUser = cva({
  base: {
    padding: "var(--gap-sm)",
    position: "relative", // ... <Ripple />
    display: "flex",
    gap: "var(--gap-md)",
    alignItems: "center",
    borderRadius: "var(--borderRadius-md)",

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
  variants: {
    watchable: {
      true: {
        cursor: "pointer",
      },
    },
    speaking: {
      true: {
        color: "var(--md-sys-color-on-surface)",

        "& svg": {
          outlineOffset: "1px",
          outline: "2px solid var(--md-sys-color-primary)",
          borderRadius: "var(--borderRadius-circle)",
        },
      },
    },
  },
});

const PreviewUsername = styled("span", {
  base: {
    ...typography.raw(),

    flexGrow: 1,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});

const LiveBadge = styled("span", {
  base: {
    flexShrink: 0,
    paddingInline: "5px",
    borderRadius: "var(--borderRadius-sm)",
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    background: "var(--md-sys-color-error)",
    color: "var(--md-sys-color-on-error)",
  },
});
