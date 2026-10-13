/** How long after a stream ended the same person's new stream is watched again */
export const REWATCH_WINDOW_MS = 30_000;

/**
 * Tell whether a stream that starts again should be watched again
 * @param endedAt Date.now() time the previous stream of this person was
 * counted as ended (not stopped by the viewer), if any
 * @param now Date.now() time
 * @returns Whether the new stream came back within the window
 */
export function shouldRewatch(
  endedAt: number | undefined,
  now: number,
  windowMs: number = REWATCH_WINDOW_MS,
): boolean {
  return endedAt !== undefined && now >= endedAt && now - endedAt <= windowMs;
}
