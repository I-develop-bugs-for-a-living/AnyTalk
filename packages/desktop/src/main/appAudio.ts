import { release } from "node:os";
import { join } from "node:path";

import { supportsProcessLoopback } from "./appAudioLogic";

/** A running per-process capture. */
export type AppAudioCapture = {
  /** Stop capturing and end the native thread. Safe to call twice. */
  stop(): void;
};

/** The functions of the native add-on (`native/app-audio`). */
export type AppAudioModule = {
  /** True on Windows build 20348 or newer. */
  isSupported(): boolean;
  /** The id of the process that owns a window. Throws for an invalid handle. */
  processIdForWindow(hwnd: bigint | number): number;
  /** The program file name of a process (`chrome.exe`), if it can be read. */
  processImageName(pid: number): string | undefined;
  /**
   * Capture one process's sound as 48 kHz stereo interleaved float32,
   * about 10 ms per chunk. `onError` fires once if the capture ends by
   * itself (e.g. the process exited). Throws if it can't start.
   */
  startCapture(
    pid: number,
    onData: (chunk: Float32Array) => void,
    onError?: (message: string) => void,
  ): AppAudioCapture;
};

/** Functions every build of the add-on must export. */
const EXPECTED_EXPORTS = [
  "isSupported",
  "processIdForWindow",
  "processImageName",
  "startCapture",
] as const;

/** Loaded module, `null` once loading failed, `undefined` before the first try. */
let loaded: AppAudioModule | null | undefined;

/**
 * Where the built add-on lies. In a packaged app the code runs from
 * `app.asar`, but a native file must be loaded from the unpacked copy.
 *
 * @returns Absolute path of `app-audio.node`
 */
function modulePath(): string {
  // dist/main.js sits next to the native folder
  const path = join(__dirname, "..", "native", "app-audio", "app-audio.node");
  return path.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/**
 * Load the per-process audio add-on on first use. It only exists in Windows
 * builds, so on every other platform, on an old Windows, or when the file
 * is missing or broken this gives undefined and the caller does without.
 *
 * @returns The module, or undefined if per-process capture isn't available
 */
export function loadAppAudio(): AppAudioModule | undefined {
  if (loaded !== undefined) return loaded ?? undefined;
  loaded = null;
  // Cheap check first, so other systems never touch the file system
  if (!supportsProcessLoopback(process.platform, release())) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(modulePath()) as AppAudioModule;
    const missing = EXPECTED_EXPORTS.filter(
      (name) => typeof mod[name] !== "function",
    );
    if (missing.length > 0) {
      // an older build of the file, left behind in the folder
      console.warn(
        `[app-audio] add-on is out of date, missing: ${missing.join(", ")}`,
      );
    } else if (mod.isSupported()) {
      loaded = mod;
    }
  } catch (error) {
    console.warn("[app-audio] per-process capture unavailable:", error);
  }
  return loaded ?? undefined;
}
