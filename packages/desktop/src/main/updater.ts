import { app, BrowserWindow, net } from "electron";
import { type UpdateDownloadedEvent, autoUpdater } from "electron-updater";
import { rm } from "node:fs/promises";
import { basename } from "node:path";

import { type UpdaterState, IPC } from "../shared/ipc";
import { TRUSTED_UPDATE_KEYS } from "./trustedUpdateKeys";
import { sha512OfFile, verifyUpdateSignature } from "./updateSignature";

/**
 * Where the releases live. Must match `publish` in electron-builder.yml: the
 * signature of an asset is `<asset url>.sig` in the same release.
 */
const RELEASE_URL =
  "https://github.com/I-develop-bugs-for-a-living/AnyTalk/releases/download/desktop-v";

/** Longest wait for a .sig file. */
const SIGNATURE_TIMEOUT_MS = 30_000;

/** Largest .sig file accepted (a few keys' lines are well under 1 KB). */
const MAX_SIGNATURE_BYTES = 16 * 1024;

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

/** The user's automatic-update setting (the install-on-quit part waits for verification). */
let autoUpdateWanted = false;

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
 * Fetch the signature file of a release asset (through Electron's network
 * stack, so proxy and certificate settings apply).
 *
 * @param version The release version
 * @param fileName The asset's file name
 * @returns The text of `<asset>.sig`
 * @throws If it can't be fetched (missing, too large, network)
 */
async function fetchSignature(
  version: string,
  fileName: string,
): Promise<string> {
  const url = `${RELEASE_URL}${encodeURIComponent(version)}/${encodeURIComponent(fileName)}.sig`;
  const response = await net.fetch(url, {
    signal: AbortSignal.timeout(SIGNATURE_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`Signature file not available (${response.status})`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_SIGNATURE_BYTES)
    throw new Error("Signature file is too large");
  // Read in chunks so a missing or lying content-length can't fill memory
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Signature file is empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SIGNATURE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("Signature file is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Delete a rejected download and make electron-updater forget it. Best
 * effort: never throws.
 *
 * @param file The downloaded file
 */
async function discardDownload(file: string) {
  try {
    await rm(file, { force: true });
    // Private field of electron-updater, so check it still looks as expected
    const helper = (
      autoUpdater as unknown as {
        downloadedUpdateHelper?: { clear?: () => Promise<unknown> };
      }
    ).downloadedUpdateHelper;
    if (typeof helper?.clear === "function") await helper.clear();
  } catch (error) {
    console.error("[updater] could not clean up the rejected download:", error);
  }
}

/**
 * Verify a downloaded update against the trusted keys and only then mark it
 * ready to install. Fails closed: with no trusted keys, a missing or invalid
 * signature, or a network error the file is deleted and the state becomes an
 * error. Never rejects.
 *
 * @param info The finished download
 */
async function verifyDownload(info: UpdateDownloadedEvent) {
  let signer: string | null;
  try {
    const fileName = basename(info.downloadedFile);
    const sigText = await fetchSignature(info.version, fileName);
    signer = verifyUpdateSignature({
      sigText,
      version: info.version,
      fileName,
      sha512Hex: await sha512OfFile(info.downloadedFile),
      trustedKeys: TRUSTED_UPDATE_KEYS,
    });
    if (!signer) throw new Error("Update signature is invalid or missing");
  } catch (error) {
    console.error("[updater] rejected the download:", error);
    autoUpdater.autoInstallOnAppQuit = false;
    // State first, so a failing cleanup can't leave it stuck on "downloading"
    failWith(error);
    await discardDownload(info.downloadedFile);
    return;
  }
  console.info(
    `[updater] ${basename(info.downloadedFile)} is signed by ${signer}`,
  );
  autoUpdater.autoInstallOnAppQuit = autoUpdateWanted;
  setState({ status: "downloaded", version: info.version });
  onUpdateReady?.();
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
  autoUpdateWanted = enabled;
  // Never install on quit before the signature was verified
  autoUpdater.autoInstallOnAppQuit = enabled && state.status === "downloaded";
  if (enabled) downloadUpdate();
}

/**
 * Install the downloaded update: quit, run the installer and relaunch.
 * Does nothing before an update is downloaded.
 */
export function installUpdate() {
  if (!active || state.status !== "downloaded") return;
  // Silent (/S) so Windows doesn't walk through the setup wizard again; the
  // installer keeps the existing install location and relaunches the app.
  autoUpdater.quitAndInstall(true, true);
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
    autoUpdateWanted = autoUpdate;
    // Off until a downloaded file passed the signature check, otherwise
    // electron-updater would install it when the app quits
    autoUpdater.autoInstallOnAppQuit = false;
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
    // electron-updater emits this and then calls addQuitHandler() right away,
    // synchronously (BaseUpdater.executeDownload). addQuitHandler only
    // registers the install-on-quit hook while autoInstallOnAppQuit is true,
    // and the hook reads the flag again at quit time. So the flag is true for
    // this one synchronous stretch (registration), then false until the signature is
    // verified; verifyDownload sets it from the user's setting afterwards.
    autoUpdater.on("update-downloaded", (info) => {
      autoUpdater.autoInstallOnAppQuit = true;
      // Microtask: runs right after this listener and the synchronous
      // addQuitHandler(), before any I/O or quit can interleave
      queueMicrotask(() => {
        autoUpdater.autoInstallOnAppQuit = false;
      });
      verifyDownload(info).catch((error) =>
        console.error("[updater] verification crashed:", error),
      );
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
