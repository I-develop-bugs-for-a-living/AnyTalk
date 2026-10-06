import { useDevice } from "@revolt/common";
import {
  type Accessor,
  type JSX,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  useContext,
} from "solid-js";

import {
  type KeyboardMenuAnchor,
  findContextMenuElement,
  isContextMenuKey,
  keyboardMenuAnchor,
} from "./contextMenuKeyboard";

type Props = JSX.Directives["floating"] & object;

export type FloatingElement = {
  config: () => Props;
  element: HTMLElement;
  hide: () => void;
  show: Accessor<Props | undefined>;
  /** Where the context menu attaches when it was opened from the keyboard */
  anchor?: Accessor<KeyboardMenuAnchor | undefined>;
  /** Open the context menu below the element (keyboard and controller) */
  openContextMenu?: (anchor: KeyboardMenuAnchor) => void;
};

/**
 * Whether the context menu being rendered was opened from the keyboard. Menus
 * use it to focus their first item instead of the menu container.
 */
const OpenedByKeyboardContext = createContext<boolean>(false);

export { OpenedByKeyboardContext };

/**
 * Whether the context menu this is called in was opened from the keyboard
 */
export function useOpenedByKeyboard(): boolean {
  return useContext(OpenedByKeyboardContext);
}

/** How long a native context menu event is ignored after a keyboard opening */
const KEYBOARD_OPEN_GUARD_MS = 600;

/** Time of the last context menu opened from the keyboard */
let lastKeyboardOpen = -Infinity;

/**
 * Anchor for a context menu opened below an element
 * @param element Element to open the menu for
 */
function anchorFor(element: HTMLElement): KeyboardMenuAnchor {
  return keyboardMenuAnchor(
    element.getBoundingClientRect(),
    document.documentElement.dir === "rtl",
    { width: window.innerWidth, height: window.innerHeight },
  );
}

/**
 * Open the context menu of an element (or of its closest parent that has one)
 * below it, as if the user asked for it with the keyboard. Used by the
 * Shift+F10 / ContextMenu key handler, and meant for a controller layer too.
 * @param element Element to start from, e.g. the focused element
 * @returns Whether a context menu was opened
 */
export function openContextMenuFor(element: HTMLElement | null): boolean {
  const entries = floatingElements();
  const match = findContextMenuElement(element, (el) =>
    entries.some(
      (entry) => entry.element === el && !!entry.config().contextMenu,
    ),
  );
  if (!match) return false;

  const entry = entries.find(
    (candidate) =>
      candidate.element === match && !!candidate.config().contextMenu,
  );
  if (!entry?.openContextMenu) return false;

  lastKeyboardOpen = Date.now();
  entry.openContextMenu(anchorFor(match));
  return true;
}

/** Key that was handled on keydown, so its keyup is swallowed too */
let handledMenuKey: string | undefined;

// a key released after the window lost focus never reports its keyup
if (typeof window !== "undefined") {
  window.addEventListener("blur", () => (handledMenuKey = undefined));
}

/**
 * Open the context menu of the focused element for the ContextMenu key and
 * Shift+F10. Keys in text fields are left to the browser (spell check, paste).
 * @param event Keydown event
 */
export function onContextMenuKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || !isContextMenuKey(event)) return;

  // holding the key: keep swallowing it, but don't toggle the menu again
  if (event.repeat) {
    if (handledMenuKey !== undefined) event.preventDefault();
    return;
  }

  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    active.isContentEditable
  )
    return;

  if (openContextMenuFor(active)) {
    // stop the browser's own menu
    event.preventDefault();
    event.stopPropagation();
    handledMenuKey = event.key;
  }
}

/**
 * Swallow the release of a key handled on keydown, because some browsers
 * open their context menu on keyup
 * @param event Keyup event
 */
export function onContextMenuKeyUp(event: KeyboardEvent) {
  if (handledMenuKey === undefined) return;
  if (event.key === handledMenuKey || event.key === "ContextMenu") {
    event.preventDefault();
    event.stopPropagation();
    handledMenuKey = undefined;
    lastKeyboardOpen = Date.now();
  }
}

const [floatingElements, setFloatingElements] = createSignal<FloatingElement[]>(
  [],
);

export { floatingElements };

/**
 * Register a new floating element
 * @param element element
 */
export function registerFloatingElement(element: FloatingElement) {
  setFloatingElements((elements) => [...elements, element]);
}

/**
 * Un register floating element
 * @param element DOM Element
 */
export function unregisterFloatingElement(element: HTMLElement) {
  setFloatingElements((elements) =>
    elements.filter((entry) => entry.element !== element),
  );
}

/**
 * Add floating elements
 * @param element Element
 * @param accessor Parameters
 */
export function floating(element: HTMLElement, accessor: Accessor<Props>) {
  if (!accessor()) return;

  const { isIOSTouch } = useDevice();

  const [show, setShow] = createSignal<Props | undefined>();
  const [anchor, setAnchor] = createSignal<KeyboardMenuAnchor | undefined>();
  // DEBUG: createEffect(() => console.info("show:", show()));

  registerFloatingElement({
    config: accessor,
    element,
    show,
    /**
     * Hide the element
     */
    hide() {
      setShow(undefined);
    },
    anchor,
    /**
     * Open the context menu below the element
     */
    openContextMenu(menuAnchor) {
      trigger("contextMenu", undefined, menuAnchor);
    },
  });

  /**
   * Trigger a floating element
   */
  function trigger(
    target: keyof Props,
    desiredState?: boolean,
    menuAnchor?: KeyboardMenuAnchor,
  ) {
    const current = show();
    const config = accessor();

    if (target === "userCard" && config.userCard) {
      if (current?.userCard) {
        setShow(undefined);
      } else if (!current) {
        setShow({ userCard: config.userCard });
      } else {
        setShow(undefined);
        setShow({ userCard: config.userCard });
      }
    }

    if (target === "tooltip" && config.tooltip) {
      if (current?.tooltip) {
        if (desiredState !== true) {
          setShow(undefined);
        }
      } else if (!current) {
        if (desiredState !== false) {
          setShow({ tooltip: config.tooltip });
        }
      }
    }

    if (target === "contextMenu" && config.contextMenu) {
      if (current?.contextMenu) {
        setShow(undefined);
      } else if (!current) {
        setAnchor(menuAnchor);
        setShow({ contextMenu: config.contextMenu });
      } else {
        setShow(undefined);
        setAnchor(menuAnchor);
        setShow({ contextMenu: config.contextMenu });
      }
    }
  }

  /**
   * Handle click events
   */
  function onClick() {
    // TODO: handle shift+click for mention
    trigger("userCard");
  }

  /**
   * Handle context menu click
   */
  function onContextMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // the browser's own contextmenu event after a keyboard opening
    if (
      event.type === "contextmenu" &&
      Date.now() - lastKeyboardOpen < KEYBOARD_OPEN_GUARD_MS
    ) {
      return;
    }

    // a click without a pointer (Enter or Space on a button) opens the menu
    // below the element, like the keyboard shortcut does
    if (
      event.type === "click" &&
      event instanceof MouseEvent &&
      event.detail === 0
    ) {
      lastKeyboardOpen = Date.now();
      trigger("contextMenu", undefined, anchorFor(element));
      return;
    }

    trigger("contextMenu");
  }

  let isTouching = false,
    tTmr: NodeJS.Timeout | undefined;

  /**
   * Handle mouse entering
   */
  function onMouseEnter() {
    if (!isTouching) trigger("tooltip", true);
  }

  /**
   * Handle mouse leaving
   */
  function onMouseLeave() {
    trigger("tooltip", false);
  }

  function onTouch() {
    isTouching = true;
    clearTimeout(tTmr);
    tTmr = setTimeout(() => {
      isTouching = false;
      tTmr = undefined;
    }, 100);
  }

  createEffect(
    on(
      () => accessor().userCard,
      (userCard) => {
        if (userCard) {
          element.style.cursor = "pointer";
          element.style.userSelect = "none";
          element.addEventListener("click", onClick);

          onCleanup(() => element.removeEventListener("click", onClick));
        }
      },
    ),
  );

  createEffect(
    on(
      () => accessor().tooltip,
      (tooltip) => {
        if (tooltip) {
          element.ariaLabel =
            typeof tooltip.content === "string"
              ? tooltip.content
              : tooltip!.aria!;

          element.addEventListener("mouseenter", onMouseEnter);
          element.addEventListener("mouseleave", onMouseLeave);
          element.addEventListener("touchstart", onTouch);
          element.addEventListener("touchend", onTouch);

          onCleanup(() => {
            element.removeEventListener("mouseenter", onMouseEnter);
            element.removeEventListener("mouseleave", onMouseLeave);
            element.removeEventListener("touchstart", onTouch);
            element.removeEventListener("touchend", onTouch);
          });
        }
      },
    ),
  );

  createEffect(
    on(
      () => accessor().contextMenu,
      (contextMenu) => {
        if (contextMenu) {
          if (
            (accessor().contextMenuHandler ?? "contextmenu") ===
              "contextmenu" &&
            isIOSTouch
          ) {
            element.addEventListener("long-press", onContextMenu);
          } else {
            element.addEventListener(
              accessor().contextMenuHandler ?? "contextmenu",
              onContextMenu,
            );
          }

          onCleanup(() => {
            if (isIOSTouch) {
              element.removeEventListener("long-press", onContextMenu);
            }
            element.removeEventListener(
              accessor().contextMenuHandler ?? "contextmenu",
              onContextMenu,
            );
          });
        }
      },
    ),
  );

  onCleanup(() => unregisterFloatingElement(element));
}
