/**
 * How long to wait for a window of the followed game after the capture
 * ended while the game still runs (e.g. its window is not shown yet while a
 * match loads)
 */
export const FOLLOW_GRACE_MAX_MS = 90_000;

/** How long to wait when the captured window is still listed */
export const FOLLOW_GRACE_SHORT_MS = 8000;

/**
 * How long to wait before reading the games again when the ended window is
 * still listed (the list can be as old as the desktop's scan interval)
 */
export const FOLLOW_GRACE_RECHECK_MS = 3500;

/**
 * Tell whether a window of a game is in the list
 * @param games Games running now
 * @param gameId The game
 * @param sourceId The window
 * @returns Whether the game lists that window
 */
export function windowListed(
  games: RunningGame[],
  gameId: string,
  sourceId: string,
): boolean {
  return !!games
    .find((g) => g.id === gameId)
    ?.windows.some((w) => w.sourceId === sourceId);
}

/**
 * How long to wait for a window after the captured one ended
 * @param games Games running now
 * @param gameId The followed game
 * @param sourceId The window that was captured
 * @returns The long wait when the game no longer lists that window (it was
 * closed or hidden), the short one when it still does (ended by hand)
 */
export function graceWaitMs(
  games: RunningGame[],
  gameId: string,
  sourceId: string,
): number {
  const listed = windowListed(games, gameId, sourceId);
  return listed ? FOLLOW_GRACE_SHORT_MS : FOLLOW_GRACE_MAX_MS;
}

/** Updates in a row without the game before it counts as stopped */
export const GONE_AFTER_UPDATES = 2;

/**
 * Count the updates in a row that lack a game, so one failed scan doesn't
 * end follow mode
 * @param games Games running now
 * @param gameId The followed game
 * @param missedBefore Updates in a row lacking it so far
 * @returns The new count, 0 when the game is there
 */
export function countMissed(
  games: RunningGame[],
  gameId: string,
  missedBefore: number,
): number {
  return games.some((g) => g.id === gameId) ? 0 : missedBefore + 1;
}

/**
 * The window of a game worth streaming
 * @param game The game
 * @returns Its first window (windows are ordered by priority), if it has any
 */
export function bestWindow(
  game: RunningGame | undefined,
): RunningGameWindow | undefined {
  return game?.windows[0];
}

/** What follow mode should do after the running games changed */
export type FollowDecision =
  | { type: "keep" }
  | { type: "switch"; sourceId: string }
  | { type: "refresh" }
  | { type: "release" };

/** How often the same window may be captured again after it stalled */
export const REFRESH_MAX_ATTEMPTS = 3;

/** The least time between two recaptures of the same window */
export const REFRESH_SPACING_MS = 8000;

/** How long the first swap from the client to a game window is delayed */
export const SWAP_TO_GAME_DELAY_MS = 4000;

/** The recaptures of one window so far */
export type RefreshState = {
  sourceId: string;
  attempts: number;
  /** Date.now() time of the last recapture */
  lastAt: number;
};

/**
 * Tell whether a stalled window may be captured again
 * @param state Recaptures so far, if any
 * @param sourceId The captured window
 * @param now Date.now() time
 * @returns False after too many attempts for this window, or when the last
 * one is too recent
 */
export function refreshAllowed(
  state: RefreshState | undefined,
  sourceId: string,
  now: number,
): boolean {
  // another window starts counting anew
  if (!state || state.sourceId !== sourceId) return true;
  return (
    state.attempts < REFRESH_MAX_ATTEMPTS &&
    now - state.lastAt >= REFRESH_SPACING_MS
  );
}

/**
 * How long to wait before moving to the game's window
 * @param games Games running now
 * @param followed The followed game and the window captured now
 * @param targetSourceId The window to move to
 * @returns The delay when moving from the client to a game window (it may
 * still be on its loading screen, not painting), otherwise 0
 */
export function swapDelayMs(
  games: RunningGame[],
  followed: { gameId: string; sourceId: string },
  targetSourceId: string,
): number {
  const windows = games.find((g) => g.id === followed.gameId)?.windows;
  const from = windows?.find((w) => w.sourceId === followed.sourceId);
  const to = windows?.find((w) => w.sourceId === targetSourceId);
  return from?.role === "client" && to?.role === "game"
    ? SWAP_TO_GAME_DELAY_MS
    : 0;
}

/**
 * Decide what a stream that follows a game should do
 * @param games Games running now
 * @param followed The followed game and the window captured now
 * @returns `release` when the game stopped running (stop following, leave the
 * stream alone), `switch` when the game's best window is another one than the
 * captured window, `refresh` when the stream stalled on the best window
 * and it may be captured again, otherwise `keep`
 */
export function followDecision(
  games: RunningGame[],
  followed: {
    gameId: string;
    sourceId: string;
    missed?: number;
    /** The stream stopped sending frames */
    stalled?: boolean;
    refresh?: RefreshState;
    /** Date.now() time, for the recapture spacing */
    now?: number;
  },
): FollowDecision {
  const game = games.find((g) => g.id === followed.gameId);
  if (!game) {
    // one missing update may be a failed scan
    return (followed.missed ?? GONE_AFTER_UPDATES) >= GONE_AFTER_UPDATES
      ? { type: "release" }
      : { type: "keep" };
  }

  const best = bestWindow(game);
  if (!best) return { type: "keep" };
  if (best.sourceId === followed.sourceId) {
    // the same window sends nothing (e.g. it was not painting yet): capture
    // it again
    return followed.stalled &&
      refreshAllowed(followed.refresh, followed.sourceId, followed.now ?? 0)
      ? { type: "refresh" }
      : { type: "keep" };
  }
  return { type: "switch", sourceId: best.sourceId };
}

/**
 * Pick the window to move to after the captured window ended
 * @param games Games running now
 * @param gameId The followed game
 * @param endedSourceId The window that was captured, which is gone
 * @param missedBefore Updates in a row lacking the game so far
 * @returns The source to capture, or undefined when there is none (yet),
 * `missed` (updates in a row lacking the game) and `gone` telling whether
 * the game stopped running altogether (missing in enough updates)
 */
export function graceWindow(
  games: RunningGame[],
  gameId: string,
  endedSourceId: string,
  missedBefore = GONE_AFTER_UPDATES - 1,
): { sourceId?: string; gone: boolean; missed: number } {
  const game = games.find((g) => g.id === gameId);
  if (!game) {
    const missed = missedBefore + 1;
    return { gone: missed >= GONE_AFTER_UPDATES, missed };
  }

  // the list can still hold the window that just closed
  const next = game.windows.find((w) => w.sourceId !== endedSourceId);
  return { sourceId: next?.sourceId, gone: false, missed: 0 };
}

/** How often the stream's frame counter is read while following a game */
export const STALL_POLL_MS = 2000;

/** How long the frame counter may stand still before the stream is stalled */
export const STALL_MS = 5000;

/** A reading of the number of frames the stream sent */
export type FrameSample = { at: number; frames: number };

/**
 * Tell whether a stream stopped sending frames, e.g. because the captured
 * window got hidden without being closed
 * @param samples Readings of the frame counter, oldest first
 * @param stallMs How long the counter must have stood still
 * @returns Whether the newest value was already there for at least `stallMs`
 */
export function isStalled(
  samples: FrameSample[],
  stallMs: number = STALL_MS,
): boolean {
  const newest = samples.at(-1);
  if (!newest) return false;

  // walk back to where the counter reached its current value
  let since = newest.at;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (samples[i].frames !== newest.frames) break;
    since = samples[i].at;
  }
  return newest.at - since >= stallMs;
}

/** How long frames must flow without a break before a window counts as live */
export const FLOW_SUSTAINED_MS = 10_000;

/**
 * Tell whether frames flowed continuously, so a recaptured window that only
 * painted a few frames and went static doesn't reset the recapture count
 * @param samples Readings of the frame counter, oldest first
 * @param flowMs How long the counter must have risen at every reading
 * @returns Whether the counter rose between all readings of the last `flowMs`
 */
export function isFlowing(
  samples: FrameSample[],
  flowMs: number = FLOW_SUSTAINED_MS,
): boolean {
  const newest = samples.at(-1);
  if (!newest) return false;

  // walk back while the counter keeps rising
  let since = newest.at;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (samples[i].frames >= samples[i + 1].frames) break;
    since = samples[i].at;
  }
  return newest.at - since >= flowMs;
}
