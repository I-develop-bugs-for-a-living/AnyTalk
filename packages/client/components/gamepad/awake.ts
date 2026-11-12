/**
 * Whether the app should ask the browser for game controllers. Chromium runs
 * a gamepad polling thread (about 1% of a core) as long as a page listens for
 * controller events or reads them, so the app only does that while the user
 * can actually use a controller: the setting is on, the window has focus and
 * the page is visible.
 * @param enabled Whether controller support is switched on
 * @param focused Whether the window has focus
 * @param visibility The document's visibility state
 * @returns Whether to listen for and read controllers
 */
export function shouldWatchGamepads(
  enabled: boolean,
  focused: boolean,
  visibility: DocumentVisibilityState,
): boolean {
  return enabled && focused && visibility === "visible";
}
