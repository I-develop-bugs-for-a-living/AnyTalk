import {
  Show,
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  untrack,
} from "solid-js";
import { Portal } from "solid-js/web";

import { autoUpdate, flip, offset, shift } from "@floating-ui/dom";
import { useLingui } from "@lingui/solid/macro";
import { useFloating } from "solid-floating-ui";
import { styled } from "styled-system/jsx";

import { useState } from "@revolt/state";
import { Slider } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { touchOnly, trackVolumePanel } from "./volumePanelState";

/**
 * Mute toggle with a volume slider for another participant. The slider sits
 * in a floating layer (not clipped by the call card) that opens on hover or
 * keyboard focus, and on touch devices by tapping the button.
 *
 * - `stream`: the audio of their screen share
 * - `voice`: their voice (the same setting as the user's context menu)
 */
export function StreamVolumeButton(props: {
  userId: string;
  /** Which volume it controls, defaults to the screen share audio */
  kind?: "stream" | "voice";
  /** The stream is not sending any audio */
  noAudio?: boolean;
  /** Which edge of the button the slider lines up with */
  align?: "start" | "end";
  /** Smaller button, e.g. for the tiles of a call window */
  compact?: boolean;
}) {
  const { t } = useLingui();
  const state = useState();

  const isStream = () => props.kind !== "voice";
  const noAudio = () => isStream() && !!props.noAudio;

  const muted = () =>
    isStream()
      ? state.voice.getScreenShareMuted(props.userId)
      : state.voice.getUserMuted(props.userId);
  const volume = () =>
    isStream()
      ? state.voice.getScreenShareVolume(props.userId)
      : state.voice.getUserVolume(props.userId);

  /** Store the volume, moving it up implies wanting to hear them again */
  function setVolume(value: number) {
    const clamped = Math.min(3, Math.max(0, value));
    if (isStream()) {
      state.voice.setScreenShareVolume(props.userId, clamped);
      if (muted() && clamped > 0) {
        state.voice.setScreenShareMuted(props.userId, false);
      }
    } else {
      state.voice.setUserVolume(props.userId, clamped);
      if (muted() && clamped > 0) state.voice.setUserMuted(props.userId, false);
    }
  }

  /** Flip the mute state */
  function toggleMuted() {
    if (isStream()) {
      state.voice.setScreenShareMuted(props.userId, !muted());
    } else {
      state.voice.setUserMuted(props.userId, !muted());
    }
  }

  const icon = () =>
    noAudio()
      ? "no_sound"
      : muted() || volume() === 0
        ? "volume_off"
        : volume() < 0.5
          ? "volume_down"
          : "volume_up";

  const muteLabel = () =>
    noAudio()
      ? t`This stream has no audio`
      : isStream()
        ? muted()
          ? t`Unmute stream`
          : t`Mute stream`
        : muted()
          ? t`Unmute user`
          : t`Mute user`;

  // on touch the button opens the panel, the mute button inside carries the state
  const label = () => (touchOnly() && !noAudio() ? t`Volume` : muteLabel());

  const panelId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [popover, setPopover] = createSignal<HTMLElement>();
  let button: HTMLButtonElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  // the mouse is over the button or the panel
  let hovered = false;
  // a slider drag is in progress
  let dragging = false;

  const position = useFloating(anchor, popover, {
    strategy: "fixed",
    // the alignment is fixed for the lifetime of the button
    placement: untrack(() => props.align) === "start" ? "top-start" : "top-end",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  /** Open now and cancel a pending close */
  function show() {
    clearTimeout(closeTimer);
    setOpen(true);
  }

  /** Close shortly after, so moving from the button to the panel is fine */
  function hideSoon() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      // on touch only an outside tap or Escape closes it, and it stays while
      // the mouse is over it, a slider is dragged or focus is inside
      if (touchOnly() || hovered || dragging) return;
      if (inside(document.activeElement)) return;
      setOpen(false);
    }, 150);
  }

  /** Whether the node belongs to the button or its panel */
  const inside = (node: Node | null) =>
    !!node && !!(anchor()?.contains(node) || popover()?.contains(node));

  // Outside taps and Escape close it while it is open
  createEffect(
    on(open, (isOpen) => {
      if (!isOpen) return;

      trackVolumePanel(true);
      onCleanup(() => {
        trackVolumePanel(false);
        hovered = false;
        dragging = false;
      });

      // a drag can end anywhere, also outside the panel
      const onPointerUp = () => {
        if (!dragging) return;
        dragging = false;
        hideSoon();
      };
      document.addEventListener("pointerup", onPointerUp, true);
      document.addEventListener("pointercancel", onPointerUp, true);

      const onPointerDown = (e: PointerEvent) => {
        if (!inside(e.target as Node)) setOpen(false);
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        // hand focus back to the button when it was inside the panel
        if (popover()?.contains(document.activeElement)) button?.focus();
        setOpen(false);
      };

      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      onCleanup(() => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("pointerup", onPointerUp, true);
        document.removeEventListener("pointercancel", onPointerUp, true);
      });
    }),
  );

  // The stream lost its audio: nothing left to adjust, close the panel
  createEffect(() => {
    if (noAudio()) setOpen(false);
  });

  onCleanup(() => clearTimeout(closeTimer));

  return (
    <Wrapper
      ref={setAnchor}
      data-open={open() ? "" : undefined}
      // Keep clicks on the control from focusing/unfocusing the tile
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      // hover opens it with a mouse only, a touch tap is handled by the button
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        hovered = true;
        show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hovered = false;
        hideSoon();
      }}
      // keyboard focus opens it, focus moving elsewhere closes it
      onFocusIn={(e) => e.target.matches(":focus-visible") && show()}
      onFocusOut={(e) => {
        if (!inside(e.relatedTarget as Node | null)) hideSoon();
      }}
    >
      <IconButton
        ref={button}
        type="button"
        compact={props.compact}
        disabled={noAudio()}
        title={label()}
        aria-label={label()}
        aria-pressed={touchOnly() || noAudio() ? undefined : muted()}
        aria-controls={open() ? panelId : undefined}
        aria-expanded={open()}
        onClick={() => {
          // no hover on touch, there a tap opens the slider instead of muting
          if (touchOnly()) setOpen(!open());
          else toggleMuted();
        }}
        onKeyDown={(e) => {
          if (noAudio()) return;
          // the panel lives outside the tile, so Tab on an open one moves
          // into it (the slider handles the arrow keys itself)
          if (e.key === "Tab" && !e.shiftKey && open()) {
            const target = popover()?.querySelector<HTMLElement>(
              "mdui-slider, button",
            );
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }
        }}
      >
        <Symbol
          size={props.compact ? 16 : 20}
          color={
            !noAudio() && muted() ? "var(--md-sys-color-error)" : undefined
          }
        >
          {icon()}
        </Symbol>
      </IconButton>
      <Show when={open() && !noAudio()}>
        {/* The fullscreen element is #floating, so only a layer inside it
            is still visible while the call is in browser fullscreen */}
        <Portal mount={document.getElementById("floating")!}>
          <Popover
            ref={setPopover}
            id={panelId}
            role="group"
            aria-label={t`Volume`}
            style={{
              visibility: position.x == null ? "hidden" : "visible",
              left: `${position.x ?? 0}px`,
              top: `${position.y ?? 0}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              e.stopPropagation();
              // keep it open while a slider drag is in progress
              dragging = true;
            }}
            onPointerEnter={(e) => {
              if (e.pointerType !== "mouse") return;
              hovered = true;
              show();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "mouse") return;
              hovered = false;
              hideSoon();
            }}
            onFocusIn={show}
            onFocusOut={(e) => {
              if (!inside(e.relatedTarget as Node | null)) hideSoon();
            }}
          >
            <Panel>
              <MuteButton
                type="button"
                title={muteLabel()}
                aria-label={muteLabel()}
                aria-pressed={muted()}
                onClick={toggleMuted}
              >
                <Symbol
                  size={20}
                  color={muted() ? "var(--md-sys-color-error)" : undefined}
                >
                  {icon()}
                </Symbol>
              </MuteButton>
              <Slider
                min={0}
                max={3}
                step={0.05}
                value={volume()}
                aria-label={t`Volume`}
                onInput={(event) => setVolume(event.currentTarget.value)}
                labelFormatter={(label) => (label * 100).toFixed(0) + "%"}
              />
              <Percent>{Math.round(volume() * 100)}%</Percent>
            </Panel>
          </Popover>
        </Portal>
      </Show>
    </Wrapper>
  );
}

/** Holds the button and anchors the floating panel */
const Wrapper = styled("div", {
  base: {
    display: "flex",
    pointerEvents: "all",
  },
});

const sizes = {
  true: { width: "24px", height: "24px" },
  false: { width: "32px", height: "32px" },
};

/** Round icon button that opens the panel or mutes */
const IconButton = styled("button", {
  base: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    padding: 0,
    border: "none",
    borderRadius: "var(--borderRadius-full)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",

    // touch targets are at least 44px, without growing the visual size
    "@media (hover: none)": {
      _after: {
        content: '""',
        position: "absolute",
        insetBlockStart: "50%",
        insetInlineStart: "50%",
        width: "44px",
        height: "44px",
        transform: "translate(-50%, -50%)",
      },
    },

    _hover: {
      background: "color-mix(in srgb, currentColor 12%, transparent)",
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
  variants: {
    compact: {
      true: sizes.true,
      false: sizes.false,
    },
  },
  defaultVariants: {
    compact: false,
  },
});

/** Mute toggle inside the panel, the button itself opens it on touch */
const MuteButton = styled("button", {
  base: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: "44px",
    height: "44px",
    padding: 0,
    border: "none",
    borderRadius: "var(--borderRadius-full)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",

    _hover: {
      background: "var(--md-sys-color-surface-container-highest)",
    },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
    },
  },
});

/** Floating layer of the slider, placed from the button's position */
const Popover = styled("div", {
  base: {
    position: "fixed",
    zIndex: 1000,
    pointerEvents: "all",
    // the slider handles touches itself, the page must not scroll or drag
    touchAction: "none",
  },
});

const Panel = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    width: "260px",
    maxWidth: "calc(100vw - 16px)",
    padding: "4px 12px 4px 4px",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    boxShadow: "0 0 8px var(--md-sys-color-shadow)",

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
