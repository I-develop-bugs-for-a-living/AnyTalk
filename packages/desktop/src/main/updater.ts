import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

import { type UpdaterState, IPC } from "../shared/ipc";

/** How often to look for a new release after the startup check. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Longest error text handed to the client. */
const MAX_ERROR_LENGTH = 200;

/**
 * Whether this install can update itself. Only packaged builds can, and on
 * Linux only the AppImage (deb, rpm and pacman are updated by the package
 * manager, and `APPIMAGE` is unset for them and for dev runs).
 *
 * @returns True if the updater should run
 */
function canAutoUpdate(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === "linux") return !!process.env.APPIMAGE;
  return true;
}

/** Current updater state, only changed through `setState`. */
let state: UpdaterState = { status: "unsupported" };

/** Whether the updater was started and can do anything. */
let active = false;

/** Called once an update is downloaded and ready to install. */
let onUpdateReady: (() => void) | undefined;

/**
 * Replace the state and tell every window.
 *
 * @param next The new state
 */
function setState(next: UpdaterState) {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.updaterState, state);
  }
}

/**
 * Get the current updater state.
 *
 * @returns A copy of the state
 */
export function getUpdaterState(): UpdaterState {
  return { ...state };
}

/**
 * Turn a thrown value into a short single-line message for the client.
 *
 * @param error Anything caught from electron-updater
 * @returns The message, trimmed to a sensible length
 */
function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.trim().split("\n")[0] || "Unknown error";
  return line.length > MAX_ERROR_LENGTH
    ? line.slice(0, MAX_ERROR_LENGTH) + "…"
    : line;
}

/**
 * Move to the error state, unless an update is already downloaded (a failed
 * check must not hide it).
 *
 * @param error The failure
 */
function failWith(error: unknown) {
  if (state.status === "downloaded") return;
  // Keep the version of a failed download so the client can offer a retry
  const { status, version } = state;
  const retryable =
    status === "available" ||
    status === "downloading" ||
    (status === "error" && version);
  setState({
    status: "error",
    error: shortError(error),
    ...(retryable && version ? { version } : {}),
  });
}

/**
 * Check for an update now. Does nothing where self-updating isn't supported
 * or while a check or download is running. Never rejects.
 */
export async function checkForUpdates(): Promise<void> {
  if (!active) return;
  const { status } = state;
  if (
    status === "checking" ||
    status === "downloading" ||
    status === "downloaded"
  )
    return;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // logged and reflected in the state by the "error" event handler
  }
}

/**
 * Start downloading the available update. Does nothing unless the state is
 * "available" (or an "error" that kept the version, to retry). Never rejects.
 */
export async function downloadUpdate(): Promise<void> {
  const retry = state.status === "error" && !!state.version;
  if (!active || (state.status !== "available" && !retry)) return;
  setState({ status: "downloading", version: state.version, percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    // logged and reflected in the state by the "error" event handler
  }
}

/**
 * Apply the automatic update setting, live. Turning it on while an update
 * is available starts the download.
 *
 * @param enabled Whether to download and install updates automatically
 */
export function setAutoUpdate(enabled: boolean) {
  // Called on every config save, so skip when nothing changed
  if (!active || autoUpdater.autoDownload === enabled) return;
  autoUpdater.autoDownload = enabled;
  autoUpdater.autoInstallOnAppQuit = enabled;
  if (enabled) downloadUpdate();
}

/**
 * Install the downloaded update: quit, run the installer and relaunch.
 * Does nothing before an update is downloaded.
 */
export function installUpdate() {
  if (!active || state.status !== "downloaded") return;
  autoUpdater.quitAndInstall();
}

/**
 * Start checking GitHub Releases for a newer shell, now and every few hours.
 * Does nothing where self-updating isn't supported (the state stays
 * "unsupported"). Never throws, so a broken updater can't interrupt startup.
 *
 * @param autoUpdate Whether updates download and install automatically
 * @param onReady Called when an update finished downloading, so the shell can
 *   offer "Restart to update" (the app lives in the tray and rarely quits)
 */
export function startUpdater(autoUpdate: boolean, onReady: () => void) {
  try {
    if (!canAutoUpdate()) return;
    active = true;
    onUpdateReady = onReady;
    autoUpdater.logger = console;
    autoUpdater.autoDownload = autoUpdate;
    autoUpdater.autoInstallOnAppQuit = autoUpdate;
    setState({ status: "idle" });

    autoUpdater.on("checking-for-update", () => {
      if (state.status !== "downloaded") setState({ status: "checking" });
    });
    autoUpdater.on("update-available", (info) => {
      if (state.status === "downloaded") return;
      // With autoDownload electron-updater starts the download itself right
      // after this event, so go straight to "downloading" (a second
      // downloadUpdate() call would start it twice)
      if (autoUpdater.autoDownload)
        setState({ status: "downloading", version: info.version, percent: 0 });
      else setState({ status: "available", version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      if (state.status !== "downloaded") setState({ status: "up-to-date" });
    });
    autoUpdater.on("download-progress", (progress) => {
      setState({
        status: "downloading",
        version: state.version,
        percent: Math.round(Math.min(100, Math.max(0, progress.percent))),
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      setState({ status: "downloaded", version: info.version });
      onUpdateReady?.();
    });
    // Errors surface through both this event and the rejected promises, so
    // only this handler logs
    autoUpdater.on("error", (error) => {
      console.error("[updater] error:", error);
      failWith(error);
    });

    checkForUpdates();
    setInterval(checkForUpdates, CHECK_INTERVAL_MS).unref();
  } catch (error) {
    console.error("[updater] could not start:", error);
  }
}
