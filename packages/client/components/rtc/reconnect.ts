import { DisconnectReason } from "livekit-client";

/** How long the SDK keeps trying to bring a dropped connection back */
export const SDK_RECONNECT_WINDOW_MS = 60_000;

/** Shortest and longest wait between two SDK reconnect attempts */
const SDK_RETRY_MIN_MS = 2_000;
const SDK_RETRY_MAX_MS = 5_000;

/** First wait before rejoining, doubled after each failed attempt */
const REJOIN_BASE_DELAY_MS = 1_000;

/** Longest wait between two rejoin attempts */
const REJOIN_MAX_DELAY_MS = 15_000;

/** How long rejoining goes on before giving up */
export const REJOIN_GIVE_UP_MS = 120_000;

/**
 * Wait for the SDK's own reconnecting: retry every 2 to 5 seconds for a
 * minute, which is longer than the default (about 30 seconds) so a wifi to
 * mobile switch or a phone waking up recovers without rejoining
 *
 * @param context What the SDK knows about the drop so far
 * @param random Random number in [0, 1), replaceable for tests
 * @returns Milliseconds until the next attempt, or null to stop retrying
 */
export function sdkRetryDelayMs(
  context: { elapsedMs: number },
  random: () => number = Math.random,
): number | null {
  if (context.elapsedMs >= SDK_RECONNECT_WINDOW_MS) return null;
  return Math.round(
    SDK_RETRY_MIN_MS + random() * (SDK_RETRY_MAX_MS - SDK_RETRY_MIN_MS),
  );
}

/**
 * How long to wait before a rejoin attempt: 1s, 2s, 4s and so on, capped
 *
 * @param attempt Number of attempts made so far, starting at 0
 */
export function rejoinDelayMs(attempt: number): number {
  return Math.min(REJOIN_BASE_DELAY_MS * 2 ** attempt, REJOIN_MAX_DELAY_MS);
}

/**
 * Whether rejoining is still worth trying
 *
 * @param elapsedMs Time spent rejoining so far
 */
export function shouldKeepRejoining(elapsedMs: number): boolean {
  return elapsedMs < REJOIN_GIVE_UP_MS;
}

/**
 * Reasons that mean the connection dropped rather than that we were sent
 * away or left on purpose. Everything else (we left, were removed, the room
 * is gone, or we joined from another device) must not rejoin; in particular
 * a duplicate identity would make two devices fight over the call.
 */
const DROPPED_REASONS: ReadonlySet<DisconnectReason | undefined> = new Set([
  undefined,
  DisconnectReason.UNKNOWN_REASON,
  DisconnectReason.SERVER_SHUTDOWN,
  DisconnectReason.STATE_MISMATCH,
  DisconnectReason.JOIN_FAILURE,
  DisconnectReason.MIGRATION,
  DisconnectReason.SIGNAL_CLOSE,
]);

/**
 * Whether we should rejoin the call after being disconnected
 *
 * @param reason Why LiveKit says we were disconnected, if it does
 */
export function shouldRejoin(reason?: DisconnectReason): boolean {
  return DROPPED_REASONS.has(reason);
}

/** How many times a broken microphone is restarted within the window below */
export const MIC_RESTART_MAX_ATTEMPTS = 3;

/** Window in which restarts of a broken microphone are counted */
export const MIC_RESTART_WINDOW_MS = 30_000;

/**
 * Decide whether the microphone may be restarted now, so a microphone that
 * keeps breaking doesn't cause a restart loop
 *
 * @param restarts When it was restarted before
 * @param now Current time
 * @returns The restarts to remember including this one, or undefined when
 * there were too many lately
 */
export function allowMicRestart(
  restarts: number[],
  now: number,
): number[] | undefined {
  const recent = restarts.filter((at) => now - at < MIC_RESTART_WINDOW_MS);
  if (recent.length >= MIC_RESTART_MAX_ATTEMPTS) return undefined;
  return [...recent, now];
}

/** Server errors that clearly mean we may not join this call */
const PERMANENT_JOIN_ERRORS = new Set([
  "NotFound",
  "NoPermission",
  "MissingPermission",
  "MissingUserPermission",
  "NotInGroup",
  "NotInServer",
  "Banned",
  "BannedUser",
  "UnknownChannel",
  "UnknownServer",
  "NotAVoiceChannel",
  "CannotJoinCall",
  "InvalidSession",
  "NotAuthenticated",
]);

/**
 * Whether a failed request for a call token will fail again however often
 * it is tried (no permission, channel gone, removed from the server). The
 * API throws the response text of an error response, which is JSON with a
 * `type`. Only the clearly permanent types give up: wrongly giving up ends
 * the call, wrongly retrying only costs some attempts. Network errors,
 * server errors and unknown types keep retrying.
 *
 * @param error What the request threw
 */
export function isPermanentJoinError(error: unknown): boolean {
  if (typeof error !== "string") return false;
  try {
    return PERMANENT_JOIN_ERRORS.has(JSON.parse(error)?.type);
  } catch {
    // not JSON, e.g. a page from a proxy that is down
    return false;
  }
}
