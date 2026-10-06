/** Keys that move focus between messages */
export type MessageNavKey =
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

/** Keys that move focus between messages, as a lookup */
const NAV_KEYS: ReadonlySet<string> = new Set<MessageNavKey>([
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Whether a keydown event moves focus between messages. Combinations with a
 * modifier are left alone (Alt+ArrowUp switches channels, Ctrl+Home belongs to
 * the browser).
 * @param event Keyboard event (or the relevant parts of it)
 */
export function isMessageNavKey(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey"
  >,
): event is typeof event & { key: MessageNavKey } {
  return (
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    NAV_KEYS.has(event.key)
  );
}

/**
 * How many messages a PageUp / PageDown skips: a screenful, minus one so the
 * last message stays in view as a reference point. Always at least one.
 * @param viewportHeight Height of the scrolling area
 * @param itemHeight Typical (average) height of one message
 */
export function messagePageSize(
  viewportHeight: number,
  itemHeight: number,
): number {
  if (!(viewportHeight > 0) || !(itemHeight > 0)) return 1;
  return Math.max(1, Math.floor(viewportHeight / itemHeight) - 1);
}

/**
 * Work out which message gets focus after a navigation key. The list is
 * ordered oldest to newest (top to bottom) and does not wrap around.
 * @param count Number of messages in the list
 * @param current Index of the focused message, or -1 if none is focused
 * @param key Key that was pressed
 * @param pageSize Messages to skip for PageUp / PageDown
 * @returns Index to focus, or -1 if the list is empty
 */
export function nextMessageIndex(
  count: number,
  current: number,
  key: MessageNavKey,
  pageSize: number,
): number {
  if (count <= 0) return -1;
  const last = count - 1;
  const clamp = (index: number) => Math.min(Math.max(index, 0), last);

  // nothing focused yet: start from the newest message, or the oldest for Home
  if (current < 0 || current > last) return key === "Home" ? 0 : last;

  switch (key) {
    case "ArrowUp":
      return clamp(current - 1);
    case "ArrowDown":
      return clamp(current + 1);
    case "PageUp":
      return clamp(current - Math.max(1, pageSize));
    case "PageDown":
      return clamp(current + Math.max(1, pageSize));
    case "Home":
      return 0;
    case "End":
      return last;
  }
}

/**
 * Which message carries the single tab stop: the one that was focused last if
 * it is still loaded, otherwise the newest.
 * @param ids Ids of the loaded messages, oldest first
 * @param activeId Id of the message focused last
 * @returns Index of the tab stop, or -1 if the list is empty
 */
export function tabStopIndex(ids: string[], activeId: string | undefined) {
  if (ids.length === 0) return -1;
  const index = activeId === undefined ? -1 : ids.indexOf(activeId);
  return index === -1 ? ids.length - 1 : index;
}
