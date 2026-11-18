/** What the "stream focused window" hotkey should do */
export type FocusedGameAction =
  | { action: "none" }
  | { action: "stop" }
  /** Nothing to stream: no focused game and no window that can be captured */
  | { action: "unavailable" }
  | { action: "start" | "swap"; gameId: string }
  /** Stream the window in front, which is no detected game */
  | { action: "start-window" | "swap-window"; sourceId: string };

/**
 * Decide what the "stream focused window" hotkey does. A focused detected
 * game wins, otherwise the window in front is streamed.
 * @param streaming Whether a screen share is running
 * @param followedGameId The game the stream follows, if any
 * @param focusedGameId The detected game that owns the window in front
 * @param foregroundSourceId Capture source of the window in front when it is
 * no detected game, undefined when it can't be captured (AnyTalk itself,
 * Wayland, lookup failed)
 * @param windowSourceId Capture source of the non-game window the stream
 * shows, if it was started with the hotkey
 * @returns Start, swap, stop, warn, or nothing
 */
export function decideFocusedGameStream(
  streaming: boolean,
  followedGameId: string | undefined,
  focusedGameId: string | undefined,
  foregroundSourceId?: string,
  windowSourceId?: string,
): FocusedGameAction {
  if (!streaming) {
    if (focusedGameId) return { action: "start", gameId: focusedGameId };
    if (foregroundSourceId) {
      return { action: "start-window", sourceId: foregroundSourceId };
    }
    return { action: "unavailable" };
  }
  // Compared by game, follow mode picks the window within a game
  if (focusedGameId) {
    return focusedGameId === followedGameId
      ? { action: "stop" }
      : { action: "swap", gameId: focusedGameId };
  }
  if (foregroundSourceId) {
    // Pressing it again in the window that is streamed stops it. A game
    // stream or a hand-picked one shows something else, so it moves over.
    return !followedGameId && foregroundSourceId === windowSourceId
      ? { action: "stop" }
      : { action: "swap-window", sourceId: foregroundSourceId };
  }
  // AnyTalk or something that can't be captured is in front
  return { action: "stop" };
}
