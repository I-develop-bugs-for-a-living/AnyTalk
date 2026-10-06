import { useFloating } from "solid-floating-ui";
import {
  Component,
  ComponentProps,
  createSignal,
  JSX,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Motion, Presence } from "solid-motionone";

import { autoUpdate, offset, shift } from "@floating-ui/dom";
import { styled } from "styled-system/jsx";

import { useModals } from "@revolt/modal";
import {
  dismissFloatingElements,
  iconSize,
  symbolSize,
  Text,
} from "@revolt/ui";

import MdChevronRight from "@material-design-icons/svg/outlined/chevron_right.svg?component-solid";

import {
  isTypeAheadKey,
  nextMenuIndex,
  submenuKeys,
  typeAheadIndex,
} from "./menuKeyboard";

const Base = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    padding: "var(--gap-md) 0",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-xs)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",
    fill: "var(--md-sys-color-on-surface)",
    boxShadow: "0 0 3px var(--md-sys-color-shadow)",

    userSelect: "none",
  },
});

/** Milliseconds after which typed characters no longer count towards type-ahead */
const TYPE_AHEAD_RESET_MS = 700;

/**
 * Focusable, visible items of a menu. Items of nested submenus aren't included
 * because submenus render in their own portal.
 * @param menu Menu element
 */
function menuItems(menu: HTMLElement) {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).filter((item) => item.getClientRects().length > 0);
}

/**
 * Focus the first item of a menu
 * @param menu Menu element
 */
function focusFirstItem(menu: HTMLElement) {
  menuItems(menu)[0]?.focus({ preventScroll: true });
}

type MenuProps = Omit<ComponentProps<typeof Base>, "ref"> & {
  /** Whether this menu is opened from a submenu trigger */
  submenu?: boolean;
  /**
   * What to focus when the menu mounts: the menu itself (default for top-level
   * menus, so keys work without showing a ring), its first item (for keyboard
   * openers) or nothing (default for submenus, which open on hover too)
   */
  initialFocus?: "container" | "first" | "none";
  /**
   * Close this menu from the keyboard. Submenus call it for ArrowLeft and
   * Escape. Top-level menus rendered outside FloatingManager (which can't be
   * closed by the global keybind) call it for Escape and Tab; without it, Tab
   * dismisses floating elements and Escape is left to the global keybind.
   */
  onRequestClose?: () => void;
  /** Receive the menu element */
  menuRef?: (element: HTMLElement) => void;
};

/**
 * Context menu container (WAI-ARIA menu): handles arrow keys, Home/End,
 * type-ahead, Enter/Space, Tab, closing submenus, and gives focus back to
 * the previously focused element when a top-level menu closes.
 */
export function ContextMenu(props: MenuProps) {
  const [local, remote] = splitProps(props, [
    "submenu",
    "initialFocus",
    "onRequestClose",
    "menuRef",
  ]);

  // remembered before the menu takes focus, restored when it closes
  const previouslyFocused = document.activeElement;
  const modals = useModals();

  // whether the menu moved focus itself, so it only gives focus back if it took it
  let tookFocus = false;
  // item that was focused when Space went down
  let spaceDownItem: HTMLElement | undefined;

  let menu: HTMLElement | undefined;
  let typed = "";
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Handle keys while focus is inside this menu. Handled keys are stopped here
   * (this listener sits below the global keybinds on body) so chat and
   * navigation keybinds never see them. Escape at the top level is left alone
   * for the CLOSE_FLOATING keybind.
   */
  function onKeyDown(event: KeyboardEvent) {
    if (!menu) return;

    /** Mark the event as handled by the menu */
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (event.key === "Escape") {
      // a submenu closes alone; the parent must not see this Escape
      if (local.onRequestClose) {
        handled();
        local.onRequestClose();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Tab") {
      handled();
      if (local.onRequestClose && !local.submenu) local.onRequestClose();
      else dismissFloatingElements();
      return;
    }

    const rtl = document.documentElement.dir === "rtl";
    if (
      local.submenu &&
      local.onRequestClose &&
      event.key === submenuKeys(rtl).close
    ) {
      handled();
      local.onRequestClose();
      return;
    }

    const items = menuItems(menu);
    const active = document.activeElement as HTMLElement | null;
    const current = active ? items.indexOf(active) : -1;

    const target = nextMenuIndex(items.length, current, event.key);
    if (target !== undefined) {
      handled();
      items[target].focus({ preventScroll: true });
      return;
    }

    if (event.key === "Enter" && current >= 0) {
      handled();
      // same as a click, including closing the menu; holding the key must
      // not activate again
      if (!event.repeat) items[current].click();
      return;
    }

    if (event.key === " ") {
      // also stops the page scrolling when no item is focused
      handled();
      if (current >= 0 && !event.repeat) {
        // activates on keyup, so that release can't click inside a modal that
        // the action opens
        spaceDownItem = items[current];
      }
      return;
    }

    if (isTypeAheadKey(event)) {
      handled();
      typed += event.key;
      clearTimeout(typedTimer);
      typedTimer = setTimeout(() => (typed = ""), TYPE_AHEAD_RESET_MS);

      const match = typeAheadIndex(
        items.map((item) => item.textContent ?? ""),
        current,
        typed,
      );
      if (match !== undefined) items[match].focus({ preventScroll: true });
    }
  }

  /**
   * Activate the focused item when Space is released
   */
  function onKeyUp(event: KeyboardEvent) {
    if (event.key !== " " || !spaceDownItem) return;
    const item = spaceDownItem;
    spaceDownItem = undefined;
    event.preventDefault();
    event.stopPropagation();

    // only if focus stayed on the item Space was pressed on
    if (document.activeElement === item) item.click();
  }

  /**
   * Keep a reference to the element and listen natively, so the handler runs
   * before the keybind listeners on body (Solid's delegated events run after)
   */
  function setMenu(element: HTMLElement) {
    menu = element;
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("keyup", onKeyUp);
    // focus moved in by hover or keys counts as the menu having taken focus
    element.addEventListener("focusin", () => (tookFocus = true));
    local.menuRef?.(element);
  }

  onMount(() => {
    const mode = local.initialFocus ?? (local.submenu ? "none" : "container");
    if (!menu) return;
    // keep focus (and the on-screen keyboard) in a text field being typed in
    const typing =
      previouslyFocused instanceof HTMLInputElement ||
      previouslyFocused instanceof HTMLTextAreaElement ||
      (previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isContentEditable);

    if (mode === "container" && !typing) {
      tookFocus = true;
      menu.focus({ preventScroll: true });
    } else if (mode === "first") {
      tookFocus = true;
      focusFirstItem(menu);
    }
  });

  onCleanup(() => {
    clearTimeout(typedTimer);
    menu?.removeEventListener("keydown", onKeyDown);
    menu?.removeEventListener("keyup", onKeyUp);
    // skip for submenus, menus that never took focus, and while a modal is
    // open (focus would land on the page behind it)
    if (local.submenu || !tookFocus || modals?.isOpen()) return;

    // give focus back, unless the user moved it elsewhere (e.g. clicked into
    // the message box to dismiss the menu)
    const active = document.activeElement;
    const focusIsInMenu =
      !active || active === document.body || !!active.closest('[role="menu"]');
    if (
      focusIsInMenu &&
      previouslyFocused instanceof HTMLElement &&
      previouslyFocused.isConnected
    ) {
      previouslyFocused.focus({ preventScroll: true });
    }
  });

  return (
    <Base
      role="menu"
      aria-orientation="vertical"
      tabIndex={-1}
      // prevent context menu closing itself before click event
      onpointerdown={(e) => e.stopImmediatePropagation()}
      ref={setMenu}
      {...remote}
    />
  );
}

const DividerBase = styled("div", {
  base: {
    height: "1px",
    margin: "var(--gap-sm) 0",
    background: "var(--md-sys-color-outline-variant)",
  },
});

/**
 * Separator between groups of menu items
 */
export function ContextMenuDivider(props: ComponentProps<typeof DividerBase>) {
  return <DividerBase role="separator" {...props} />;
}

const ItemBase = styled("a", {
  base: {
    display: "flex",
    gap: "var(--gap-md)",
    alignItems: "center",
    padding: "var(--gap-md) var(--gap-lg)",

    // hovering focuses the item, so hover and keyboard share one highlight
    "&:focus": {
      outline: "none",
      background:
        "color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent)",
    },

    // ring for keyboard users, inset so the menu's overflow doesn't clip it
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },

    "& span": {
      flexGrow: 1,
    },
  },
  variants: {
    selected: {
      true: {
        background:
          "color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent)",
      },
      false: {},
    },
    action: {
      true: {
        cursor: "pointer",
      },
    },
    button: {
      true: {
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "var(--gap-md)",
        "& span": {
          marginTop: "1px",
        },
      },
    },
    _titleCase: {
      true: {},
      false: {},
    },
    destructive: {
      true: {
        fill: "var(--md-sys-color-error)",
        color: "var(--md-sys-color-error)",
      },
    },
  },
  defaultVariants: {
    _titleCase: true,
    selected: false,
  },
  compoundVariants: [
    {
      _titleCase: true,
      button: true,
      css: {
        textTransform: "capitalize",
      },
    },
  ],
});

/**
 * Menu item: focusable with arrow keys (roving focus) and focused on hover
 */
export function ContextMenuItem(props: ComponentProps<typeof ItemBase>) {
  const [local, remote] = splitProps(props, ["onMouseEnter", "onMouseLeave"]);

  return (
    <ItemBase
      role="menuitem"
      tabIndex={-1}
      {...remote}
      onMouseEnter={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        const handler = local.onMouseEnter;
        if (typeof handler === "function") handler(event);
      }}
      onMouseLeave={(event) => {
        // clear the hover highlight, unless a submenu is open from this item
        const item = event.currentTarget;
        if (
          document.activeElement === item &&
          item.getAttribute("aria-expanded") !== "true"
        ) {
          item.closest<HTMLElement>('[role="menu"]')?.focus({
            preventScroll: true,
          });
        }
        const handler = local.onMouseLeave;
        if (typeof handler === "function") handler(event);
      }}
    />
  );
}

type ButtonProps = ComponentProps<typeof ContextMenuItem> & {
  icon?: JSX.Element | Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  symbol?: JSX.Element | Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  destructive?: boolean;
  actionIcon?: JSX.Element | Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  actionSymbol?: JSX.Element | Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

/**
 * Menu item with optional icons and a text label
 */
export function ContextMenuButton(props: ButtonProps) {
  const [local, remote] = splitProps(props, [
    "icon",
    "symbol",
    "actionIcon",
    "actionSymbol",
    "children",
  ]);

  return (
    <ContextMenuItem button {...remote}>
      {typeof local.icon === "function"
        ? local.icon?.(iconSize(16))
        : local.icon}
      {typeof local.symbol === "function"
        ? local.symbol(symbolSize(16))
        : local.symbol}
      <Text>{local.children}</Text>
      {typeof local.actionIcon === "function"
        ? local.actionIcon?.(iconSize(20))
        : local.actionIcon}
      {typeof local.actionSymbol === "function"
        ? local.actionSymbol(symbolSize(20))
        : local.actionSymbol}
    </ContextMenuItem>
  );
}

/**
 * Menu item that opens a nested menu on hover, click or keyboard
 */
export function ContextMenuSubMenu(
  props: Omit<
    ButtonProps,
    "ref" | "onClick" | "onMouseEnter" | "onMouseLeave"
  > & {
    buttonContent: JSX.Element;
    onClick?: () => void;
  },
) {
  const [anchor, setAnchor] = createSignal<HTMLAnchorElement>();
  const [ref, setRef] = createSignal<HTMLDivElement>();

  // submenu content element, and whether it should focus its first item once
  // it mounts (keyboard open)
  let menuElement: HTMLElement | undefined;
  let focusOnMount = false;

  const [show, setShow] = createSignal<"hide" | "show" | boolean>(false);
  const [local, buttonProps] = splitProps(props, [
    "children",
    "buttonContent",
    "onClick",
  ]);

  function isShowing() {
    return show() === true || show() === "show";
  }

  // submenus open towards the reading direction
  const rtl = document.documentElement.dir === "rtl";

  const position = useFloating(anchor, ref, {
    placement: rtl ? "left-start" : "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(5), shift()],
  });

  /**
   * Whether the submenu should focus its first item as it mounts; resets so
   * a later hover-open doesn't steal focus
   */
  function takeFocusOnMount() {
    const value = focusOnMount;
    focusOnMount = false;
    return value;
  }

  /**
   * Open the submenu from the keyboard and move focus into it
   */
  function openFromKeyboard() {
    if (isShowing() && menuElement?.isConnected) {
      // "show" so leaving with the mouse doesn't close it
      setShow("show");
      focusFirstItem(menuElement);
    } else {
      focusOnMount = true;
      setShow("show");
    }
  }

  /**
   * Close only this submenu and give focus back to its trigger
   */
  function closeFromKeyboard() {
    focusOnMount = false;
    setShow(false);
    anchor()?.focus({ preventScroll: true });
  }

  /**
   * Keys on the trigger: open the submenu (not for triggers with their own click action)
   */
  function onTriggerKeyDown(event: KeyboardEvent) {
    if (local.onClick) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const rtl = document.documentElement.dir === "rtl";
    if (
      event.key === submenuKeys(rtl).open ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      event.stopPropagation();
      // holding Enter or Space must not run again on the submenu's first item
      if (event.repeat && event.key !== submenuKeys(rtl).open) return;
      openFromKeyboard();
    }
  }

  return (
    <>
      <ContextMenuButton
        ref={(element: HTMLAnchorElement) => {
          setAnchor(element);
          // native listener so it runs before the parent menu's handler
          element.addEventListener("keydown", onTriggerKeyDown);
        }}
        aria-haspopup="menu"
        aria-expanded={isShowing()}
        selected={isShowing()}
        actionIcon={<MdChevronRight {...iconSize(20)} class="rtl-mirror" />}
        onpointerdown={(e) => {
          e.stopImmediatePropagation();
        }}
        onClick={(e) => {
          if (local.onClick) {
            local.onClick();
          } else {
            e.stopImmediatePropagation();
            setShow(isShowing() ? false : "show");
          }
        }}
        onMouseEnter={() => setShow((show) => (show === "hide" ? show : true))}
        {...buttonProps}
      >
        {local.buttonContent}
      </ContextMenuButton>
      <Portal mount={document.getElementById("floating")!}>
        <Presence>
          <Show when={isShowing()}>
            <Motion
              ref={setRef}
              style={{
                position: position.strategy,
                top: `${position.y ?? 0}px`,
                left: `${position.x ?? 0}px`,
                "z-index": 1000,
              }}
              initial={{ opacity: 0, x: rtl ? 24 : -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, easing: [0.87, 0, 0.13, 1] }}
              onMouseLeave={() => {
                // don't drop keyboard focus into nothing
                if (
                  show() === true &&
                  menuElement?.contains(document.activeElement)
                )
                  anchor()?.focus({ preventScroll: true });
                setShow((show) => (show === true ? false : show));
              }}
              // stop submenu from closing context menu
              onpointerdown={(e) => e.stopImmediatePropagation()}
            >
              <div
                onClick={(e) => {
                  if (local.onClick) {
                    local.onClick();
                  } else {
                    // prevent submenu trigger from closing context menu
                    e.stopImmediatePropagation();
                    setShow((show) => (show ? "hide" : true));
                  }
                }}
                // float a virtual element to ensure the mouseLeave event covers
                // both the anchor/button we attached to and the newly created context menu
                style={{
                  position: "fixed",
                  top: 0,
                  [rtl ? "right" : "left"]:
                    `-${(anchor()?.clientWidth ?? 0) + 5}px`,
                  width: `${(anchor()?.clientWidth ?? 0) + 5}px`,
                  height: `${anchor()?.clientHeight ?? 0}px`,
                  cursor: "pointer",
                }}
              />
              <ContextMenu
                submenu
                // read once when the submenu mounts
                initialFocus={takeFocusOnMount() ? "first" : "none"}
                onRequestClose={closeFromKeyboard}
                menuRef={(element) => (menuElement = element)}
              >
                {local.children}
              </ContextMenu>
            </Motion>
          </Show>
        </Presence>
      </Portal>
    </>
  );
}
