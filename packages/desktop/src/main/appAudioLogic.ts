/** First Windows build with per-process loopback capture. */
export const MIN_PROCESS_LOOPBACK_BUILD = 20348;

/**
 * Read the window handle out of a `desktopCapturer` source id.
 *
 * @param sourceId Source id such as `window:263538:0`
 * @returns The HWND, or undefined if the id isn't a window id
 */
export function windowHandleFromSourceId(sourceId: string): bigint | undefined {
  const match = /^window:(\d+):\d+$/.exec(sourceId);
  if (!match) return undefined;
  const handle = BigInt(match[1]);
  return handle > 0n ? handle : undefined;
}

/**
 * Read the build number out of `os.release()` on Windows ("10.0.22631").
 *
 * @param release The OS release string
 * @returns The build number, or undefined if it can't be read
 */
export function windowsBuildFromRelease(release: string): number | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(release);
  if (!match) return undefined;
  return Number(match[3]);
}

/**
 * Whether this OS can capture one process's audio. A cheap check done before
 * the native module is even loaded.
 *
 * @param platform The OS the app runs on
 * @param release The OS release string
 * @returns True on Windows build 20348 or newer
 */
export function supportsProcessLoopback(
  platform: string,
  release: string,
): boolean {
  if (platform !== "win32") return false;
  const build = windowsBuildFromRelease(release);
  return build !== undefined && build >= MIN_PROCESS_LOOPBACK_BUILD;
}

/**
 * Whether a program is the host of UWP windows. A window of such an app
 * belongs to this process, which plays none of the app's sound.
 *
 * @param imageName Program file name such as `ApplicationFrameHost.exe`
 * @returns True for `ApplicationFrameHost.exe` (any case)
 */
export function isUwpHost(imageName: string | undefined): boolean {
  return imageName?.toLowerCase() === "applicationframehost.exe";
}
