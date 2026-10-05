import { useLingui } from "@lingui/solid/macro";
import { Show } from "solid-js";

import { styled } from "styled-system/jsx";

import { useState } from "@revolt/state";
import { Slider } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Mute toggle for a user's screen share audio, with a volume slider on hover
 */
export function StreamVolumeButton(props: {
  userId: string;
  /** The stream is not sending any audio */
  noAudio: boolean;
  /** Which edge of the button the slider lines up with */
  align?: "start" | "end";
}) {
  const { t } = useLingui();
  const state = useState();

  const muted = () => state.voice.getScreenShareMuted(props.userId);
  const volume = () => state.voice.getScreenShareVolume(props.userId);

  const icon = () =>
    props.noAudio
      ? "no_sound"
      : muted() || volume() === 0
        ? "volume_off"
        : volume() < 0.5
          ? "volume_down"
          : "volume_up";

  return (
    <Wrapper
      // Keep clicks on the control from focusing/unfocusing the tile
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <IconButton
        type="button"
        disabled={props.noAudio}
        title={
          props.noAudio
            ? t`This stream has no audio`
            : muted()
              ? t`Unmute stream`
              : t`Mute stream`
        }
        aria-pressed={!props.noAudio && muted()}
        onClick={() => state.voice.setScreenShareMuted(props.userId, !muted())}
      >
        <Symbol
          size={20}
          color={
            !props.noAudio && muted() ? "var(--md-sys-color-error)" : undefined
          }
        >
          {icon()}
        </Symbol>
      </IconButton>
      <Show when={!props.noAudio}>
        <Popover class="stream-volume-popover" align={props.align ?? "end"}>
          <Panel>
            <Slider
              min={0}
              max={3}
              step={0.05}
              value={volume()}
              onInput={(event) => {
                state.voice.setScreenShareVolume(
                  props.userId,
                  event.currentTarget.value,
                );
                // Moving the slider up implies wanting to hear the stream
                if (muted() && event.currentTarget.value > 0) {
                  state.voice.setScreenShareMuted(props.userId, false);
                }
              }}
              labelFormatter={(label) => (label * 100).toFixed(0) + "%"}
            />
            <Percent>{Math.round(volume() * 100)}%</Percent>
          </Panel>
        </Popover>
      </Show>
    </Wrapper>
  );
}

const Wrapper = styled("div", {
  base: {
    position: "relative",
    display: "flex",
    pointerEvents: "all",

    "&:hover .stream-volume-popover, &:focus-within .stream-volume-popover": {
      opacity: 1,
      pointerEvents: "all",
      transform: "translateY(0)",
    },
  },
});

const IconButton = styled("button", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "32px",
    height: "32px",
    padding: 0,
    border: "none",
    borderRadius: "var(--borderRadius-full)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",

    _hover: {
      background: "#fff2",
    },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
    },
    _disabled: {
      cursor: "default",
      background: "transparent",
      opacity: 0.7,
    },
  },
});

const Popover = styled("div", {
  base: {
    position: "absolute",
    bottom: "100%",
    zIndex: 2,
    // Padding bridges the gap so the hover is kept while moving to the panel
    paddingBottom: "var(--gap-sm)",

    opacity: 0,
    pointerEvents: "none",
    transform: "translateY(4px)",
    transition: "opacity .15s ease, transform .15s ease",
  },
  variants: {
    align: {
      start: { insetInlineStart: 0 },
      end: { insetInlineEnd: 0 },
    },
  },
});

const Panel = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    width: "200px",
    padding: "var(--gap-xs) var(--gap-md)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    boxShadow: "0 2px 8px #0006",

    "& mdui-slider": {
      flexGrow: 1,
    },
  },
});

const Percent = styled("span", {
  base: {
    minWidth: "3.5ch",
    textAlign: "end",
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  },
});
