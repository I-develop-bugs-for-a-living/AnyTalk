/**
 * How many recently joined calls are remembered per user. The setting
 * "Recent calls on Home" can show up to this many.
 */
export const MAX_RECENT_CALLS = 10;

/**
 * How many recent calls Home shows unless the user changes it.
 */
export const DEFAULT_RECENT_CALLS_SHOWN = 5;

/**
 * Clamp the "Recent calls on Home" setting to a whole number from 0 to the
 * number of remembered calls.
 * @param value Stored or typed value
 * @returns A valid count, the default for anything that isn't a number
 */
export function clampRecentCallsShown(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RECENT_CALLS_SHOWN;
  }
  return Math.min(MAX_RECENT_CALLS, Math.max(0, Math.round(value)));
}

/**
 * Put a channel at the front of the recent list, without duplicates, and
 * keep only the newest few.
 * @param list Current list, most recent first
 * @param channelId Channel that was just joined
 * @returns New list
 */
export function pushRecentCall(list: string[], channelId: string): string[] {
  return [channelId, ...list.filter((id) => id !== channelId)].slice(
    0,
    MAX_RECENT_CALLS,
  );
}

/**
 * Validate stored recent calls: only string ids per user, capped in length.
 * @param input Untrusted stored value
 * @returns Clean record of user id to channel ids
 */
export function cleanRecentCalls(input: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (typeof input !== "object" || input === null) return result;

  for (const [userId, ids] of Object.entries(input)) {
    if (!Array.isArray(ids)) continue;
    const clean = ids.filter((id): id is string => typeof id === "string");
    result[userId] = [...new Set(clean)].slice(0, MAX_RECENT_CALLS);
  }

  return result;
}
