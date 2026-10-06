/** Placement of a context menu opened from the keyboard */
export type KeyboardMenuPlacement = "bottom-start" | "bottom-end";

/** Rectangle in client (viewport) coordinates */
export type MenuRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/** Where to put a context menu that was opened from the keyboard */
export type KeyboardMenuAnchor = {
  /** Rectangle the menu attaches to */
  rect: MenuRect;
  /** Side and alignment of the menu relative to the rectangle */
  placement: KeyboardMenuPlacement;
};

/**
 * Whether a keydown event asks for the context menu: the ContextMenu key or
 * Shift+F10 (without other modifiers)
 * @param event Keyboard event (or the relevant parts of it)
 */
export function isContextMenuKey(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey"
  >,
): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.key === "ContextMenu") return !event.shiftKey;
  return event.key === "F10" && event.shiftKey;
}

/**
 * Work out where a context menu opened from the keyboard goes: right below the
 * element, lined up with its start edge (left in left-to-right, right in
 * right-to-left). The rectangle is cut to the viewport, so a tall or partly
 * scrolled-out element still gets its menu on screen.
 * @param rect Bounding rectangle of the element
 * @param rtl Whether the page is right-to-left
 * @param viewport Size of the visible area
 */
export function keyboardMenuAnchor(
  rect: Pick<MenuRect, "left" | "right" | "top" | "bottom">,
  rtl: boolean,
  viewport: { width: number; height: number },
): KeyboardMenuAnchor {
  const clamp = (value: number, max: number) =>
    Math.min(Math.max(value, 0), max);

  const left = clamp(rect.left, viewport.width);
  const right = Math.max(left, clamp(rect.right, viewport.width));
  const top = clamp(rect.top, viewport.height);
  const bottom = Math.max(top, clamp(rect.bottom, viewport.height));

  return {
    rect: {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      right,
      top,
      bottom,
    },
    placement: rtl ? "bottom-end" : "bottom-start",
  };
}

/**
 * Find the closest element (starting with the given one, then its parents)
 * that offers a context menu
 * @param start Element to start from, usually the focused element
 * @param hasMenu Whether an element offers a context menu
 */
export function findContextMenuElement<T extends { parentElement: T | null }>(
  start: T | null,
  hasMenu: (element: T) => boolean,
): T | undefined {
  for (let el = start; el; el = el.parentElement) {
    if (hasMenu(el)) return el;
  }
  return undefined;
}
