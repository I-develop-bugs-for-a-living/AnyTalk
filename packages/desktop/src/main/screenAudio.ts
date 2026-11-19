/**
 * What sound can be shared with a captured source. Only set on Windows:
 * - `screen`: a whole screen, system loopback (without AnyTalk's own sound),
 *   all system sound is the point
 * - `app`: a window whose own process is captured (per-process capture), only
 *   that app's sound is shared
 * - `game`: a window without per-process capture (no add-on, an old Windows,
 *   no process found, or a UWP window): system loopback without AnyTalk's own
 *   sound, other apps' sound comes along. The name stays from the time only
 *   games could do this, the picker shows the "other apps' sound" note for it.
 * - `none`: AnyTalk's own windows, no sound is shared (it would echo the call)
 */
export type SourceAudio = "screen" | "app" | "game" | "none";

/**
 * What the per-process capture add-on can do for one source. Absent when the
 * add-on is missing or unsupported, which keeps the loopback fallback.
 */
export type AppCapture = {
  /** The process that owns the window, undefined if it can't be found */
  pid: number | undefined;
  /** AnyTalk's own process and its children */
  ownPids: readonly number[];
  /**
   * Whether the window belongs to `ApplicationFrameHost.exe`, the host of UWP
   * windows. Capturing that process tree gets none of the app's sound.
   */
  uwpHost: boolean;
};

/**
 * Work out what sound a source may share.
 *
 * @param platform The OS the app runs on
 * @param sourceId The `desktopCapturer` source id
 * @param isOwn Whether the source is one of AnyTalk's own windows
 * @param app Per-process capture info for the source, when the add-on works
 * @returns The kind, or undefined off Windows (nothing is restricted there)
 */
export function sourceAudio(
  platform: string,
  sourceId: string,
  isOwn: boolean,
  app?: AppCapture,
): SourceAudio | undefined {
  if (platform !== "win32") return undefined;
  if (sourceId.startsWith("screen:")) return "screen";
  // our own windows would echo the call back into it
  if (isOwn || (app?.pid !== undefined && app.ownPids.includes(app.pid)))
    return "none";
  if (app && app.pid !== undefined && !app.uwpHost) return "app";
  return "game";
}

/**
 * Decide whether to capture system audio (loopback) for a source. Loopback
 * is Windows only: for screens, and for windows that per-process capture
 * can't handle. The page asks for it without AnyTalk's own sound.
 *
 * @param platform The OS the app runs on
 * @param wanted Whether the user and the page asked for audio
 * @param sourceId The `desktopCapturer` source id
 * @param isOwn Whether the source is one of AnyTalk's own windows
 * @param app Per-process capture info for the source, when the add-on works
 * @returns "loopback", or undefined for no audio
 */
export function loopbackFor(
  platform: string,
  wanted: boolean,
  sourceId: string,
  isOwn: boolean,
  app?: AppCapture,
): "loopback" | undefined {
  if (!wanted || platform !== "win32") return undefined;
  const kind = sourceAudio(platform, sourceId, isOwn, app);
  return kind === "screen" || kind === "game" ? "loopback" : undefined;
}
