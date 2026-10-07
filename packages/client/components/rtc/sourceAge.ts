/**
 * Age of an RTP synchronization source reading
 *
 * Chrome reports `timestamp` in Unix epoch time, while the spec puts it on the
 * page's performance timeline (relative to `performance.timeOrigin`). The two
 * clocks are decades apart, so the closer one is the right one.
 * @param timestamp The source's timestamp
 * @param perfNow Current `performance.now()`
 * @param epochNow Current Unix time in ms
 * @returns Age in ms
 */
export function sourceAge(
  timestamp: number,
  perfNow: number,
  epochNow: number,
): number {
  return Math.min(
    Math.abs(perfNow - timestamp),
    Math.abs(epochNow - timestamp),
  );
}
