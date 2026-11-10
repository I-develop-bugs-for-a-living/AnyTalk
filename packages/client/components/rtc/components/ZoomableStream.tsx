import { createSignal, JSX, onCleanup, onMount, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { useVoice } from "../state";
import {
  BUTTON_STEP,
  clampPan,
  FramePoint,
  FrameSize,
  isZoomed,
  NO_ZOOM,
  passedDragThreshold,
  StreamZoom,
  wheelFactor,
  zoomAt,
} from "../streamZoom";

/**
 * Zoom state and actions of one watched stream. The state itself lives in the
 * Voice class (keyed by track id), so it follows the stream between views.
 * @param id Track id (see Voice.trackId)
 * @param enabled Whether this view lets the user zoom
 */
export function createStreamZoom(id: () => string, enabled: () => boolean) {
  const voice = useVoice();
  const [size, setSize] = createSignal<FrameSize>({ width: 0, height: 0 });

  /** Zoom as drawn: stored pans are re-fitted to the current frame size */
  const zoom = () => clampPan(voice.zooms.get(id()) ?? NO_ZOOM, size());

  /** Store a zoom, a stream that fits has no entry */
  const set = (next: StreamZoom) => {
    if (isZoomed(next)) voice.zooms.set(id(), next);
    else voice.zooms.delete(id());
  };

  /** Centre of the frame */
  const center = (): FramePoint => ({
    x: size().width / 2,
    y: size().height / 2,
  });

  /** Scale by a factor around a point of the frame (default the centre) */
  const zoomBy = (factor: number, point = center()) =>
    set(zoomAt(zoom(), zoom().scale * factor, point, size()));

  /** Back to fit */
  const reset = () => set(NO_ZOOM);

  /**
   * Keyboard zoom for the focused tile: + / = in, - out, 0 reset
   * @returns Whether the key was used
   */
  const onKey = (e: KeyboardEvent) => {
    if (!enabled() || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === "+" || e.key === "=") zoomBy(BUTTON_STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / BUTTON_STEP);
    else if (e.key === "0") reset();
    else return false;
    e.preventDefault();
    return true;
  };

  return {
    enabled,
    zoom,
    set,
    setSize,
    getSize: size,
    zoomBy,
    reset,
    onKey,
  };
}

/** What createStreamZoom returns */
export type StreamZoomController = ReturnType<typeof createStreamZoom>;

/**
 * Lets the user zoom into the stream it wraps (desktop only): mouse wheel or
 * pinch zooms toward the cursor, dragging pans, and a small pill offers
 * buttons. The frame is always rendered, so the children are never recreated;
 * while `enabled` is false it does nothing and the picture is not transformed.
 *
 * All listeners are native ones: delegated Solid events never fire in a popout
 * window. The wrapped element must fill its parent (width and height 100%).
 *
 * Conflicts with the surroundings:
 * - a drag stops its pointerdown so the floating call window doesn't move
 *   (only while zoomed; at 100% the window can still be dragged by the stream)
 * - the click that ends a drag is swallowed in the capture phase
 */
export function ZoomableStream(props: {
  zoom: StreamZoomController;
  children: JSX.Element;
  /** Push the pill down, clear of a bar along the top edge */
  belowBar?: boolean;
}) {
  const { t } = useLingui();

  let frame: HTMLDivElement | undefined;

  onMount(() => {
    const el = frame;
    if (!el) return;
    const win = el.ownerDocument.defaultView as
      | (Window & typeof globalThis)
      | null;

    /** Frame point of a mouse event */
    const pointOf = (e: MouseEvent): FramePoint => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /** Report the frame size, the pan limits depend on it */
    const measure = () =>
      props.zoom.setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const Observer = win?.ResizeObserver ?? ResizeObserver;
    const resize = new Observer(measure);
    resize.observe(el);

    /** Wheel and pinch zoom toward the cursor */
    const onWheel = (e: WheelEvent) => {
      if (!props.zoom.enabled()) return;
      // the page must not scroll or zoom under a zoomable stream
      e.preventDefault();
      const current = props.zoom.zoom();
      props.zoom.set(
        zoomAt(
          current,
          current.scale * wheelFactor(e, el.clientHeight),
          pointOf(e),
          props.zoom.getSize(),
        ),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // drag to pan
    let press:
      | { pid: number; startX: number; startY: number; origin: StreamZoom }
      | undefined;
    let dragging = false;
    let suppressClick = false;

    const onPointerDown = (e: PointerEvent) => {
      if (!props.zoom.enabled()) return;
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (!isZoomed(props.zoom.zoom())) return;
      press = {
        pid: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origin: props.zoom.zoom(),
      };
      // the floating call window must not start moving
      e.stopPropagation();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.pid) return;
      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;
      if (!dragging) {
        if (!passedDragThreshold(dx, dy)) return;
        dragging = true;
        el.dataset.dragging = "";
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // pointer already gone, the drag ends on the next event
        }
      }
      e.stopPropagation();
      props.zoom.set(
        clampPan(
          { ...press.origin, x: press.origin.x + dx, y: press.origin.y + dy },
          props.zoom.getSize(),
        ),
      );
    };
    const endPress = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.pid) return;
      if (dragging) {
        // the click that ends a drag must not toggle focus or the controls
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
        e.stopPropagation();
      }
      press = undefined;
      dragging = false;
      delete el.dataset.dragging;
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPress);
    el.addEventListener("pointercancel", endPress);
    el.addEventListener("lostpointercapture", endPress);

    /** Swallow the click that ends a drag, before the tile sees it */
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("click", onClickCapture, true);

    onCleanup(() => {
      resize.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPress);
      el.removeEventListener("pointercancel", endPress);
      el.removeEventListener("lostpointercapture", endPress);
      el.removeEventListener("click", onClickCapture, true);
    });
  });

  /** Keep a press on a pill button from reaching the tile or the window */
  const stop = (e: Event) => e.stopPropagation();

  /** Enter and Space on a pill button must not also press the tile */
  const stopActivation = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  };

  /** The zoom as a percentage, for the reset button */
  const percent = () => `${Math.round(props.zoom.zoom().scale * 100)}%`;

  return (
    <Frame
      ref={frame}
      data-enabled={props.zoom.enabled() ? "" : undefined}
      data-zoomed={
        props.zoom.enabled() && isZoomed(props.zoom.zoom()) ? "" : undefined
      }
    >
      <Picture
        style={{
          transform: props.zoom.enabled()
            ? `translate(${props.zoom.zoom().x}px, ${props.zoom.zoom().y}px) scale(${props.zoom.zoom().scale})`
            : undefined,
        }}
      >
        {props.children}
      </Picture>
      <Show when={props.zoom.enabled()}>
        {/* desktop only: no zoom on phones (user decision) */}
        <Pill
          role="group"
          aria-label={t`Zoom`}
          data-zoom-pill=""
          data-visible={isZoomed(props.zoom.zoom()) ? "" : undefined}
          belowBar={props.belowBar}
          on:pointerdown={stop}
          on:click={stop}
          on:keydown={stopActivation}
        >
          <PillButton
            type="button"
            aria-label={t`Zoom out`}
            title={t`Zoom out`}
            on:click={() => props.zoom.zoomBy(1 / BUTTON_STEP)}
          >
            <Symbol size={18}>remove</Symbol>
          </PillButton>
          <PillValue
            type="button"
            aria-label={t`Reset zoom`}
            title={t`Reset zoom`}
            on:click={() => props.zoom.reset()}
          >
            {percent()}
          </PillValue>
          <PillButton
            type="button"
            aria-label={t`Zoom in`}
            title={t`Zoom in`}
            on:click={() => props.zoom.zoomBy(BUTTON_STEP)}
          >
            <Symbol size={18}>add</Symbol>
          </PillButton>
        </Pill>
      </Show>
    </Frame>
  );
}

/** Clips the zoomed picture, fills the stream area */
const Frame = styled("div", {
  base: {
    gridArea: "1/1",
    position: "relative",
    overflow: "hidden",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,

    // stops touchpads from turning a drag into a browser gesture
    "&[data-enabled]": { touchAction: "none" },
    "&[data-zoomed]": { cursor: "grab" },
    "&[data-dragging]": { cursor: "grabbing" },
  },
});

/** The picture itself; the zoom moves it from the top-left corner */
const Picture = styled("div", {
  base: {
    display: "grid",
    width: "100%",
    height: "100%",
    transformOrigin: "0 0",
  },
});

/** Zoom buttons at the top-start corner, shown on hover or while zoomed */
const Pill = styled("div", {
  base: {
    position: "absolute",
    insetInlineStart: 0,
    insetBlockStart: 0,
    zIndex: 1,
    margin: "var(--gap-sm)",
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "2px",
    borderRadius: "var(--borderRadius-full)",
    background:
      "color-mix(in srgb, var(--md-sys-color-surface-container) 85%, transparent)",
    color: "var(--md-sys-color-on-surface)",
    cursor: "default",
    opacity: 0,
    transition: "var(--transitions-fast) opacity",

    "&[data-visible]": { opacity: 1 },
    ".group:hover &": { opacity: 1 },
    ".group:focus-within &": { opacity: 1 },
    "&:focus-within": { opacity: 1 },
  },
  variants: {
    belowBar: { true: { marginBlockStart: "var(--popout-bar-height, 48px)" } },
  },
});

/**
 * Round icon button of the pill. Zoom is desktop-only, so 28px is fine and
 * the 44px touch target rule does not apply.
 */
const PillButton = styled("button", {
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
    background: "transparent",
    color: "inherit",

    _hover: {
      background:
        "color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)",
    },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "1px",
    },
  },
});

/** The zoom percentage, a button that resets the zoom */
const PillValue = styled("button", {
  base: {
    minWidth: "48px",
    height: "28px",
    paddingInline: "var(--gap-sm)",
    border: "none",
    borderRadius: "var(--borderRadius-full)",
    cursor: "pointer",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: "12px",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",

    _hover: {
      background:
        "color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)",
    },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "1px",
    },
  },
});
