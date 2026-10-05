/** Reverse-DNS app id, shared by the installer, the portal and notifications. */
export const APP_ID = "tech.anyportal.AnyTalk";

/** Desktop environment name (`XDG_CURRENT_DESKTOP`), empty on Windows. */
export const desktopEnvironment =
  process.platform === "win32" ? "" : (process.env.XDG_CURRENT_DESKTOP ?? "");

/** Whether the session runs on Wayland (Linux only). */
export const isWayland =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);
