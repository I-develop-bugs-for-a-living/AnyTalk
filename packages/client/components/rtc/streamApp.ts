/** Participant attribute holding the game or program a streamer shows */
export const STREAM_APP_ATTRIBUTE = "streamApp";

/** Longest label that is shared or shown, in characters */
export const STREAM_APP_MAX_LENGTH = 64;

/**
 * Clean a label from the desktop app or another participant: control
 * characters become spaces, white space is collapsed and the length capped.
 * @param raw Any value
 * @returns The label, or undefined when nothing is left
 */
export function sanitizeStreamApp(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  const trimmed = clean.trim();
  if (!trimmed) return undefined;
  return Array.from(trimmed).slice(0, STREAM_APP_MAX_LENGTH).join("").trim();
}

/**
 * Read the shared game or program name out of a participant's attributes
 * @param attributes The participant's attributes
 * @returns The cleaned label, or undefined when none is shared
 */
export function streamAppOf(
  attributes: Record<string, string> | undefined,
): string | undefined {
  return sanitizeStreamApp(attributes?.[STREAM_APP_ATTRIBUTE]);
}
