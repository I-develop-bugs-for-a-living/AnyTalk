/** Participant attribute a streamer sets while game follow mode is on */
export const FOLLOW_ATTRIBUTE = "streamFollow";

/**
 * How long viewers wait for a followed stream to come back after it was
 * unpublished: a source swap takes about 5.5 s, with some room to spare
 */
export const FOLLOW_REPUBLISH_WAIT_MS = 20_000;

/**
 * Tell whether a participant announces that they follow a game
 * @param attributes The participant's attributes
 */
export function isFollowing(
  attributes: Record<string, string> | undefined,
): boolean {
  return !!attributes?.[FOLLOW_ATTRIBUTE];
}

/**
 * Pick how long to wait for an unpublished stream to come back
 * @param attributes The streamer's attributes
 * @param defaultMs The wait for an ordinary stream
 */
export function republishWaitMs(
  attributes: Record<string, string> | undefined,
  defaultMs: number,
): number {
  return isFollowing(attributes)
    ? Math.max(defaultMs, FOLLOW_REPUBLISH_WAIT_MS)
    : defaultMs;
}

/**
 * Tell whether an attributes update means a streamer left follow mode
 * @param changed The attributes that changed, with their new values
 * @param attributes All attributes of the participant now
 */
export function followCleared(
  changed: Record<string, string> | undefined,
  attributes: Record<string, string> | undefined,
): boolean {
  return !!changed && FOLLOW_ATTRIBUTE in changed && !isFollowing(attributes);
}
