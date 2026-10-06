/**
 * Pure helpers for keyboard navigation in context menus (WAI-ARIA "menu"
 * pattern). They work on indexes and labels so they can be tested without a DOM.
 */

/**
 * Index of the item to focus after a navigation key
 * @param count Number of focusable items
 * @param current Index of the focused item, or -1 when none is focused
 * @param key Key name (ArrowDown, ArrowUp, Home or End)
 * @returns New index, or undefined if the key doesn't navigate or there are no items
 */
export function nextMenuIndex(
  count: number,
  current: number,
  key: string,
): number | undefined {
  if (count <= 0) return undefined;

  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * Index of the item matching the characters typed so far
 *
 * Typing one letter repeatedly cycles through items starting with it. A longer
 * string looks for an item starting with the whole string, beginning at the
 * focused item.
 * @param labels Item labels in menu order
 * @param current Index of the focused item, or -1 when none is focused
 * @param typed Characters typed in the current type-ahead burst
 * @returns Index of the match, or undefined if nothing matches
 */
export function typeAheadIndex(
  labels: string[],
  current: number,
  typed: string,
): number | undefined {
  const count = labels.length;
  const needle = typed.toLowerCase();
  if (count === 0 || !needle) return undefined;

  const repeated = [...needle].every((char) => char === needle[0]);
  const search = repeated ? needle[0] : needle;
  // a repeated letter moves on from the focused item, a longer prefix may keep it
  const start = repeated ? current + 1 : Math.max(current, 0);

  for (let offset = 0; offset < count; offset++) {
    const index = (((start + offset) % count) + count) % count;
    if (labels[index].trim().toLowerCase().startsWith(search)) return index;
  }

  return undefined;
}

/**
 * Keys that open and close a submenu, which flip in right-to-left layouts
 * @param rtl Whether the layout is right-to-left
 */
export function submenuKeys(rtl: boolean) {
  return {
    open: rtl ? "ArrowLeft" : "ArrowRight",
    close: rtl ? "ArrowRight" : "ArrowLeft",
  };
}

/**
 * Whether a key press is a printable character meant for type-ahead
 * @param event Key event (only the relevant fields)
 */
export function isTypeAheadKey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): boolean {
  return (
    event.key.length === 1 &&
    event.key !== " " &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}
