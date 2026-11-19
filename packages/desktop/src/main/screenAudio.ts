/**
 * What sound can be shared with a captured source. Only set on Windows,
 * where sharing is system loopback and so can't be limited to one window:
 * - `screen`: a whole screen, all system sound is the point
 * - `game`: a detected game window, other apps' sound comes along
 * - `none`: any other window, no sound is shared
 */
export type SourceAudio = "screen" | "game" | "none";

/**
 * Work out what sound a source may share.
 *
 * @param platform The OS the app runs on
 * @param sourceId The `desktopCapturer` source id
 * @param isGame Whether the source is a detected game window
 * @returns The kind, or undefined off Windows (nothing is restricted there)
 */
export function sourceAudio(
  platform: string,
  sourceId: string,
  isGame: boolean,
): SourceAudio | undefined {
  if (platform !== "win32") return undefined;
  if (sourceId.startsWith("screen:")) return "screen";
  return isGame ? "game" : "none";
}

/**
 * Decide whether to capture system audio (loopback) for a source. Loopback
 * is Windows only, and there only for screens and games, so a plain window
 * never gets every other app's sound.
 *
 * @param platform The OS the app runs on
 * @param wanted Whether the user and the page asked for audio
 * @param sourceId The `desktopCapturer` source id
 * @param isGame Whether the source is a detected game window
 * @returns "loopback", or undefined for no audio
 */
export function loopbackFor(
  platform: string,
  wanted: boolean,
  sourceId: string,
  isGame: boolean,
): "loopback" | undefined {
  if (!wanted || platform !== "win32") return undefined;
  return sourceAudio(platform, sourceId, isGame) === "none"
    ? undefined
    : "loopback";
}
