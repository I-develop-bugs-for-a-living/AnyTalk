/** What the "stream focused game" hotkey should do */
export type FocusedGameAction =
  | { action: "none" }
  | { action: "stop" }
  | { action: "start" | "swap"; gameId: string };

/**
 * Decide what the "stream focused game" hotkey does.
 * @param streaming Whether a screen share is running
 * @param followedGameId The game the stream follows, if any
 * @param games Ids of the detected games, in list order
 * @param focusedGameId The detected game that owns the window in front
 * @returns Start, swap, stop, or nothing
 */
export function decideFocusedGameStream(
  streaming: boolean,
  followedGameId: string | undefined,
  games: string[],
  focusedGameId: string | undefined,
): FocusedGameAction {
  if (!streaming) {
    // Without a focused game: the only game, or else the first one
    const gameId = focusedGameId ?? games[0];
    return gameId ? { action: "start", gameId } : { action: "none" };
  }
  // Compared by game, follow mode picks the window within a game
  if (focusedGameId && focusedGameId !== followedGameId) {
    return { action: "swap", gameId: focusedGameId };
  }
  return { action: "stop" };
}
