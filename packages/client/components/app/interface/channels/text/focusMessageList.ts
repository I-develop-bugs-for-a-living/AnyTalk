/**
 * Whether the message that has focus got it from a mouse or touch press. Then
 * the navigation keys keep scrolling the pane as they always did.
 */
let pointerFocus = false;

/**
 * Record whether focus in the message list came from a pointer press
 * @param value New value
 */
export function setPointerFocus(value: boolean) {
  pointerFocus = value;
}

/**
 * Whether the focused message was focused by a pointer press
 * @returns Boolean
 */
export function isPointerFocus(): boolean {
  return pointerFocus;
}

/**
 * Move keyboard focus into the message list, onto the message that is the
 * list's tab stop (the one focused last, or the newest). Meant for shortcuts
 * and a later controller layer.
 * @returns Whether a message was focused
 */
export function focusMessageList(): boolean {
  const items = document.querySelectorAll<HTMLElement>(
    "[data-message-list] [data-message-item]",
  );
  const item =
    Array.from(items).find((el) => el.tabIndex === 0) ??
    items[items.length - 1];
  if (!item) return false;

  pointerFocus = false;
  item.tabIndex = 0;
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: "nearest" });
  return true;
}
