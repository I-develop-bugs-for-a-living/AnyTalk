/**
 * A capture source id that may be preselected once, until it expires. The
 * expiry is a single timestamp, so every check against it agrees.
 */
export type Allowance = { sourceId: string; expires: number };

/**
 * Grant an allowance.
 *
 * @param sourceId The `desktopCapturer` source id
 * @param now Current time in ms
 * @param ttlMs How long it stays valid
 * @returns The allowance
 */
export function grantAllowance(
  sourceId: string,
  now: number,
  ttlMs: number,
): Allowance {
  return { sourceId, expires: now + ttlMs };
}

/**
 * Use up an allowance. It works once: a granted use clears it, and so does
 * finding it expired. A different source id leaves it alone.
 *
 * @param allowance The current allowance, if any
 * @param now Current time in ms
 * @param sourceId The id asked for, undefined for whichever is granted
 * @returns The granted id (undefined if refused) and the allowance left
 */
export function takeAllowance(
  allowance: Allowance | undefined,
  now: number,
  sourceId?: string,
): { granted: string | undefined; next: Allowance | undefined } {
  if (!allowance) return { granted: undefined, next: undefined };
  if (allowance.expires <= now) return { granted: undefined, next: undefined };
  if (sourceId !== undefined && sourceId !== allowance.sourceId) {
    return { granted: undefined, next: allowance };
  }
  return { granted: allowance.sourceId, next: undefined };
}
