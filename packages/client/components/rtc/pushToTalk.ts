/** How the microphone is opened: by voice activity or by holding a key */
export type InputMode = "voice" | "ptt";

/** How long the mic stays on after letting go of the key, so the last word isn't clipped */
export const PTT_RELEASE_DELAY_MS = 200;

/**
 * Whether the microphone should be sending right now.
 *
 * `micOn` is the user's persisted mute preference. In push to talk it acts as
 * a hard mute that the key can't override; push to talk never changes it.
 * @param opts.speak Whether the user may speak in the channel
 * @param opts.deafen Whether the user is deafened
 * @param opts.micOn The persisted mute preference
 * @param opts.mode Input mode
 * @param opts.pttOpen Whether the push to talk key is held (or just released)
 */
export function micShouldBeOn(opts: {
  speak: boolean;
  deafen: boolean;
  micOn: boolean;
  mode: InputMode;
  pttOpen: boolean;
}): boolean {
  if (!opts.speak || opts.deafen || !opts.micOn) return false;
  return opts.mode === "ptt" ? opts.pttOpen : true;
}

/** Where a push to talk press comes from: the keyboard or a controller */
export type PttSource = "keys" | "pad";

/**
 * Whether push to talk is held: any source holding it keeps the mic open
 * @param held Whether each source holds it
 */
export function pttHeld(held: Record<PttSource, boolean>): boolean {
  return held.keys || held.pad;
}
