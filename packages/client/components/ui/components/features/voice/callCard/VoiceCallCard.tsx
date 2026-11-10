import {
  JSX,
  Match,
  Show,
  Switch,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { Portal } from "solid-js/web";

import { useLingui } from "@lingui/solid/macro";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { Channel } from "stoat.js";
import { styled } from "styled-system/jsx";

import { titlebarBottom, useDevice } from "@revolt/common";
import { useVoice } from "@revolt/rtc";
import { VoiceLayout } from "@revolt/rtc/state";
import { useState } from "@revolt/state";
import { SlideState } from "@revolt/ui/components/navigation/SlideDrawer";

import {
  Insets,
  KEY_STEP,
  Point,
  Size,
  clampPosition,
  defaultPosition,
  moveByKey,
  parseStoredPosition,
  passedDragThreshold,
} from "./callWindowPlacement";
import { VoiceCallCardActiveRoom } from "./VoiceCallCardActiveRoom";
import { VoiceCallCardPiP } from "./VoiceCallCardPiP";
import { VoiceCallCardPreview } from "./VoiceCallCardPreview";

type Mode = "floating" | "moving";

type Info = {
  channel: Channel;
  pos: DOMRect;
  parentRect: DOMRect;
  drawer?: SlideState;
};

/** Where the floating window position is remembered on this device */
const POSITION_KEY = "anytalk:callWindowPosition";

/**
 * Read the remembered window position
 * @returns The position, if one was saved and is readable
 */
function loadPosition(): Point | undefined {
  try {
    return parseStoredPosition(localStorage.getItem(POSITION_KEY));
  } catch {
    return undefined;
  }
}

/**
 * Remember the window position on this device; failures (private mode,
 * full storage) are ignored
 * @param pos Position to save
 */
function savePosition(pos: Point) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
  } catch {
    // not remembered, the window still works
  }
}

/** Hidden element used to read the safe-area insets, created once */
let insetProbe: HTMLDivElement | undefined;

/**
 * Measure the space the floating window must keep clear: the safe areas
 * (notch, home indicator) and the app title bar if it is showing.
 * @returns Insets in pixels
 */
function measureInsets(): Insets {
  // CSS env() can only be read through a styled element
  if (!insetProbe || !insetProbe.isConnected) {
    insetProbe = document.createElement("div");
    insetProbe.setAttribute("aria-hidden", "true");
    insetProbe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;" +
      "padding:env(safe-area-inset-top) env(safe-area-inset-right) " +
      "env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(insetProbe);
  }
  const style = getComputedStyle(insetProbe);
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };

  const titlebar = document.querySelector("[data-titlebar]");
  if (titlebar) {
    insets.top = Math.max(insets.top, titlebar.getBoundingClientRect().bottom);
  }
  return insets;
}

/**
 * Size of the floating window. Must match the `--flt-w` / `--flt-h` values of
 * the `Float` styles; computed here so the size is right before the styles
 * have been applied and while the window animates.
 * @returns Size in pixels
 */
function floatingSize(): Size {
  const width = Math.min(328, window.innerWidth - 32);
  return { width, height: width * 0.57 };
}

/** Size of the viewport the window floats in */
function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

const callCardContext = createContext<(info?: Info) => void>();

/** Voice call card context */
export function VoiceCallCardContext(props: { children: JSX.Element }) {
  const voice = useVoice();
  const device = useDevice();
  const { t } = useLingui();
  const inCall = () => !!voice.channel();

  const [mode, setMode] = createSignal<Mode>();
  const [info, setInfo] = createSignal<Info>();

  let ref: HTMLDivElement | undefined;

  /** Where the user wants the window; clamped whenever it is shown */
  let wanted: Point | undefined = loadPosition();

  /** Where the window was last put (the target, not the animated position) */
  let applied: Point | undefined;

  /**
   * The press that may turn into a drag: pointer id, where it started and
   * where the window was then
   */
  let drag:
    | { pid: number; startX: number; startY: number; origin: Point }
    | undefined;

  /** Whether the press has moved far enough to be a drag */
  let dragging = false;

  /** Whether the click that ends a drag should be swallowed */
  let suppressClick = false;

  /** Put the window at the wanted position, kept inside the viewport */
  function applyPosition(pos?: Point) {
    const size = floatingSize();
    const insets = measureInsets();
    const viewport = viewportSize();
    const target = clampPosition(
      pos ?? wanted ?? defaultPosition(size, viewport, insets),
      size,
      viewport,
      insets,
    );
    ref!.style.transform = `translate(${target.x}px, ${target.y}px)`;
    applied = target;
    return target;
  }

  /** Where the window is going to be (not mid-animation) */
  function currentPosition(): Point {
    return applied ?? applyPosition();
  }

  /** Stop any drag in progress */
  function endDrag() {
    drag = undefined;
    dragging = false;
  }

  /**
   * Remember a press on the window; it becomes a drag once the pointer moved
   * a few pixels. Presses on the control buttons never get here, the button
   * handles them and stops the event, so they can't start a drag.
   * @param e Pointer event
   */
  function pointerDown(e: PointerEvent) {
    if (mode() !== "floating" || !e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag = {
      pid: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: currentPosition(),
    };
  }

  /**
   * Move the window with the pointer once the drag threshold is passed
   * @param e Pointer event
   */
  function pointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.startX,
      dy = e.clientY - drag.startY;

    if (!dragging) {
      // small movements are clicks on the controls inside the card
      if (!passedDragThreshold(dx, dy)) return;
      dragging = true;
      setMode("moving");
      try {
        ref!.setPointerCapture(e.pointerId);
      } catch {
        // pointer already gone, the drag ends on the next event
      }
    }

    e.preventDefault();
    applyPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy });
  }

  /**
   * End a drag: remember where the window is
   * @param e Pointer event
   */
  function pointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (dragging) {
      wanted = currentPosition();
      savePosition(wanted);
      // the click that ends the drag must not press a button
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      setMode("floating");
    }
    endDrag();
  }

  /**
   * A drag that the browser took away (cancelled or capture lost): keep the
   * window where it is and remember that
   * @param e Pointer event
   */
  function pointerCancel(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (dragging) {
      wanted = currentPosition();
      savePosition(wanted);
      setMode("floating");
    }
    endDrag();
  }

  /**
   * Arrow keys move the window when the window itself has focus
   * @param e Keyboard event
   */
  function keyDown(e: KeyboardEvent) {
    if (mode() !== "floating" || e.target !== e.currentTarget) return;
    const next = moveByKey(
      currentPosition(),
      e.key,
      e.shiftKey ? KEY_STEP * 4 : KEY_STEP,
    );
    if (!next) return;
    e.preventDefault();
    wanted = applyPosition(next);
    savePosition(wanted);
  }

  /** Swallow the click that follows a drag */
  function clickCapture(e: MouseEvent) {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Show the floating window at the remembered position */
  function showFloating() {
    const sty = ref!.style;
    sty.width = "";
    sty.height = "";
    applyPosition();
    setMode("floating");
  }

  createEffect(() => {
    const inf = info();
    if (!ref) return;
    const sty = ref.style;

    // The floating window is for watching a stream: in a call, a stream to
    // show, not on a phone (there the call lives in the voice channel)
    const floatingWanted =
      inCall() && !!voice.pipTrack() && device.layout() !== "phone";

    // a parked window must not take focus
    ref.inert = false;

    //Set mode based on state
    if (voice.layout() === "fullscreen") {
      endDrag();
      sty.transform = ``;
      sty.width = `100%`;
      sty.height = "";
      setMode();
    } else if (
      voice.layout() === "expanded" &&
      inf?.parentRect &&
      (!inf.drawer || inf.drawer === SlideState.SHOWN)
    ) {
      endDrag();
      sty.transform = `translate(${inf.parentRect.x}px, ${inf.parentRect.y}px)`;
      sty.width = `${inf.parentRect.width}px`;
      sty.height = `${inf.parentRect.height}px`;
      setMode();
    } else if (inf?.pos && (!inf.drawer || inf.drawer === SlideState.SHOWN)) {
      endDrag();
      sty.transform = `translate(${inf.pos.x}px, ${inf.pos.y}px)`;
      sty.width = `${inf.pos.width}px`;
      sty.height = voice.layout() === "collapsed" ? "56px" : "";
      setMode();
    } else if (!floatingWanted) {
      // nothing to float: park the window off screen
      endDrag();
      ref.inert = true;
      const y = inf?.pos.y ?? ref.getBoundingClientRect().y;
      sty.transform = `translate(${innerWidth + 50}px, ${y}px)`;
      sty.width = "";
      sty.height = "";
      setMode();
    } else if (!mode()) showFloating();
  });

  /** The voice channel the docked call card belongs to */
  const channel = () => info()?.channel;

  let reclampFrame = 0;

  /** Keep the window inside the viewport when it changes, once per frame */
  function reclamp() {
    if (reclampFrame) return;
    reclampFrame = requestAnimationFrame(() => {
      reclampFrame = 0;
      if (ref && mode() === "floating") applyPosition(wanted);
    });
  }

  onMount(() => {
    window.addEventListener("resize", reclamp);
    window.visualViewport?.addEventListener("resize", reclamp);
    onCleanup(() => {
      window.removeEventListener("resize", reclamp);
      window.visualViewport?.removeEventListener("resize", reclamp);
      cancelAnimationFrame(reclampFrame);
    });
  });

  // the title bar comes and goes (disconnected banner) and changes height
  createEffect(() => {
    titlebarBottom();
    reclamp();
  });

  onMount(() => {
    document
      .getElementById("floating")
      ?.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) voice.resetLayout();
      });
  });

  // iPhones have no fullscreen API, there the call card only fills the page
  createEffect(() => {
    const floating = document.getElementById("floating");
    if (!floating?.requestFullscreen) return;

    if (voice.layout() === "fullscreen" && inCall()) {
      if (!floating.isSameNode(document.fullscreenElement)) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        floating.requestFullscreen().catch(() => {});
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  });

  return (
    <callCardContext.Provider value={setInfo}>
      {props.children}
      <Portal mount={document.getElementById("floating")! as HTMLDivElement}>
        <Float
          ref={(el: HTMLDivElement) => {
            ref = el;
            // capture phase, so a drag never presses a button underneath
            el.addEventListener("click", clickCapture, true);
            el.addEventListener("lostpointercapture", pointerCancel);
          }}
          mode={mode()}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerCancel}
          onKeyDown={keyDown}
          // arrow keys move the window while it has focus
          tabIndex={mode() ? 0 : undefined}
          role={mode() ? "group" : undefined}
          aria-label={
            mode()
              ? t`Stream window. Use the arrow keys to move it.`
              : undefined
          }
          fullscreen={voice.layout() === "fullscreen"}
        >
          <Switch>
            <Match when={mode() && inCall()}>
              <VoiceCallCardPiP />
            </Match>
            <Match when={channel()}>
              <VoiceCallCard
                channel={channel()!}
                inCall={inCall()}
                showCard={voice.showCard(channel()!)}
                layout={voice.layout()}
              />
            </Match>
          </Switch>
        </Float>
      </Portal>
    </callCardContext.Provider>
  );
}

const Float = styled("div", {
  base: {
    position: "fixed",
    zIndex: 10,
    pointerEvents: "none",
    transition: "all .3s cubic-bezier(1, 0, 0, 1)",
    height: "40vh",
    touchAction: "none",
    borderRadius: "var(--borderRadius-lg)",
    outlineOffset: "2px",
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
    },
  },
  variants: {
    mode: {
      floating: { cursor: "grab" },
      moving: {
        cursor: "grabbing",
        transition: "none",
      },
    },
    fullscreen: {
      true: {
        zIndex: 100,
        // the visible height below the notch, Safari's toolbar covers part
        // of 100vh; the call keeps its controls clear of the home indicator
        top: "env(safe-area-inset-top)",
        height: "calc(100dvh - env(safe-area-inset-top))",
        // Width is set by floating logic in effect above
      },
    },
  },
  compoundVariants: [
    {
      mode: ["floating", "moving"],
      css: {
        // Wide enough for the mini control bar (7 buttons: 6x32px + the
        // 48px hang-up, 6x8px gaps, 8px bar padding, 8px card padding),
        // clamped to the viewport with a 16px gutter
        "--flt-w": "min(328px, calc(100vw - 32px))",
        "--flt-h": "calc(var(--flt-w) * 0.57)",
        width: "var(--flt-w)",
        height: "var(--flt-h)",
      },
    },
  ],
});

/** 'Marker' to send position information for mounting the floating call card */
export function VoiceChannelCallCardMount(props: { channel: Channel }) {
  const voice = useVoice();
  const state = useState();
  const setInfo = useContext(callCardContext)!;
  let ref: HTMLDivElement | undefined;

  function updateInfo() {
    const vc = voice.channel();
    setInfo(
      !vc || vc.id === props.channel.id
        ? {
            channel: props.channel,
            pos: ref!.getBoundingClientRect(),
            parentRect: ref!.parentElement!.getBoundingClientRect(),
            drawer: state.appDrawer()?.state,
          }
        : undefined,
    );
  }

  createEffect(updateInfo);

  onMount(() => {
    const target = ref?.parentElement;
    if (!target) return;

    createResizeObserver(target, updateInfo);
  });
  onCleanup(() => {
    setInfo();
  });

  return <div ref={ref!} />;
}

/**
 * Call card
 */
function VoiceCallCard(props: {
  channel: Channel;
  inCall: boolean;
  showCard: boolean;
  layout: VoiceLayout;
}) {
  return (
    <Show when={props.showCard}>
      <Base layout={props.layout as never}>
        <Card active={props.inCall} layout={props.layout}>
          <Show
            when={props.inCall}
            fallback={<VoiceCallCardPreview channel={props.channel} />}
          >
            <VoiceCallCardActiveRoom />
          </Show>
        </Card>
      </Base>
    </Show>
  );
}

const Base = styled("div", {
  base: {
    left: 0,
    top: "var(--gap-md)",
    padding: "var(--gap-md)",

    width: "100%",
    height: "100%",
    position: "absolute",

    zIndex: 2,
    userSelect: "none",
    pointerEvents: "none",

    display: "flex",
    alignItems: "center",
    flexDirection: "column",
    transition: "all var(--transitions-medium)",
  },
  variants: {
    layout: {
      fullscreen: {
        top: 0,
        height: "100%",
        padding: 0,
      },
      expanded: {
        top: 0,
        height: "100%",
        padding: 0,
      },
    },
  },
});

const Card = styled("div", {
  base: {
    pointerEvents: "all",

    maxWidth: "100%",
    transition: "var(--transitions-fast) all",
    transitionTimingFunction: "ease-in-out",

    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-secondary-container)",
  },
  variants: {
    active: {
      true: {
        width: "100%",
        height: "100%",
      },
      false: {
        width: "360px",
        height: "120px",
        cursor: "pointer",
      },
    },
    layout: {
      fullscreen: {
        borderRadius: 0,
      },
      expanded: {
        borderRadius: "var(--borderRadius-xl)",
      },
      collapsed: {
        background: "none",
      },
    },
  },
});
