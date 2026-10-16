import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type DesktopConfig,
  type OverlayCorner,
  type OverlayParticipant,
  type OverlayRender,
  type OverlayState,
  IPC,
} from "../shared/ipc";
import { getConfig } from "./config";
import { getLatestGames } from "./games";

/** The overlay page, bundled next to the main script. */
const overlayPagePath = join(__dirname, "overlay", "index.html");
/** URL of the overlay page, the preload keys its bridge off it. */
export const overlayPageUrl = pathToFileURL(overlayPagePath).toString();

/** Width of the overlay window in pixels. */
const WIDTH = 280;
/** Rows the window has room for, the rest of a bigger call is cut. */
const MAX_ROWS = 10;
/** Height of one row plus its gap, see the overlay page's styles. */
const ROW_HEIGHT = 42;
/** Window height: all rows plus the list padding. */
const HEIGHT = MAX_ROWS * ROW_HEIGHT + 8;
/** Distance to the screen edges. */
const MARGIN = 12;

let overlay: BrowserWindow | undefined;
/** Whether the overlay page finished loading and can take state. */
let pageReady = false;
/** The newest snapshot from the main window. */
let state: OverlayState = { inCall: false, participants: [] };
/** Gives the main window, set by `installOverlay`. */
let getMain: () => BrowserWindow | undefined = () => undefined;
/** Last throttling value applied to the main window. */
let throttlingOff = false;

/**
 * Whether the overlay should be on screen.
 *
 * @param config Desktop settings
 * @param snapshot Call snapshot
 * @param gameRunning Whether a game is detected
 * @returns True when all conditions hold
 */
export function shouldShowOverlay(
  config: Pick<DesktopConfig, "overlayEnabled" | "overlayMode">,
  snapshot: OverlayState,
  gameRunning: boolean,
): boolean {
  return (
    config.overlayEnabled &&
    snapshot.inCall &&
    snapshot.participants.length > 0 &&
    (config.overlayMode === "always" || gameRunning)
  );
}

/**
 * Keep only well-formed data from the page: the sender is trusted, but the
 * payload still ends up in another window.
 *
 * @param value Anything the page sent
 * @returns A clean snapshot, empty if the value is unusable
 */
export function sanitiseOverlayState(value: unknown): OverlayState {
  const empty: OverlayState = { inCall: false, participants: [] };
  if (typeof value !== "object" || value === null) return empty;
  const source = value as Record<string, unknown>;
  if (source.inCall !== true || !Array.isArray(source.participants))
    return empty;

  const participants: OverlayParticipant[] = [];
  for (const item of source.participants.slice(0, MAX_ROWS)) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.name !== "string") continue;
    let avatar: string | undefined;
    if (typeof p.avatar === "string") {
      // Only web images, never file: or other schemes
      try {
        const url = new URL(p.avatar);
        if (url.protocol === "https:" || url.protocol === "http:")
          avatar = url.toString();
      } catch {
        // Not a URL, the page shows the letter instead
      }
    }
    participants.push({
      id: p.id.slice(0, 64),
      name: p.name.slice(0, 64),
      avatar,
      speaking: p.speaking === true,
      streaming: p.streaming === true,
      muted: p.muted === true,
      deafened: p.deafened === true,
      watchingYou: p.watchingYou === true,
    });
  }
  const label = typeof source.liveLabel === "string" ? source.liveLabel : "";
  const text = (value: unknown) =>
    typeof value === "string"
      ? value.trim().slice(0, 32) || undefined
      : undefined;
  return {
    inCall: true,
    liveLabel: label.trim().slice(0, 16) || undefined,
    mutedLabel: text(source.mutedLabel),
    deafenedLabel: text(source.deafenedLabel),
    watchingLabel: text(source.watchingLabel),
    participants,
  };
}

/**
 * Where the window goes for a corner of the primary display.
 *
 * @param corner Chosen corner
 * @returns Window bounds
 */
function boundsFor(corner: OverlayCorner): Electron.Rectangle {
  const area = screen.getPrimaryDisplay().workArea;
  const height = Math.min(HEIGHT, Math.max(0, area.height - MARGIN * 2));
  return {
    width: WIDTH,
    height,
    x: corner.endsWith("left")
      ? area.x + MARGIN
      : area.x + area.width - WIDTH - MARGIN,
    y: corner.startsWith("top")
      ? area.y + MARGIN
      : area.y + area.height - height - MARGIN,
  };
}

/** Create the hidden, click-through overlay window. */
function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    ...boundsFor(getConfig().overlayCorner),
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    // The main window's bridge must not leak in, this has its own preload
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true);
  try {
    // Lets it sit over fullscreen windows where the platform supports it
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // Not supported here
  }
  // Nothing may open or navigate away from the local page
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const name of [
    "will-navigate",
    "will-redirect",
    "will-frame-navigate",
    "will-attach-webview",
  ] as const)
    win.webContents.on(name as "will-navigate", (event) =>
      event.preventDefault(),
    );
  win.webContents.on("did-finish-load", () => {
    pageReady = true;
    push();
  });
  win.on("closed", () => {
    overlay = undefined;
    pageReady = false;
  });
  pageReady = false;
  win.loadFile(overlayPagePath).catch(() => {});
  return win;
}

/** Send the current snapshot and look to the overlay page. */
function push() {
  if (!overlay || overlay.isDestroyed() || !pageReady) return;
  const config = getConfig();
  const payload: OverlayRender = {
    ...state,
    elements: {
      overlayAvatar: config.overlayAvatar,
      overlayName: config.overlayName,
      overlayLive: config.overlayLive,
      overlayStatus: config.overlayStatus,
      overlayWatching: config.overlayWatching,
    },
    corner: config.overlayCorner,
  };
  overlay.webContents.send(IPC.overlayState, payload);
}

/**
 * Let the main window's timers run at full speed while the overlay shows:
 * speaking detection polls every 50 ms, and Chromium would slow that down
 * for a window behind a game or in the tray.
 *
 * @param off True to turn background throttling off
 */
function setThrottling(off: boolean) {
  if (off === throttlingOff) return;
  const main = getMain();
  if (!main || main.isDestroyed()) {
    throttlingOff = false;
    return;
  }
  throttlingOff = off;
  main.webContents.setBackgroundThrottling(!off);
}

/**
 * Bring the window in line with settings, games and the call snapshot:
 * show, hide, move and redraw. Call after any of them changed.
 */
export function refreshOverlay() {
  const main = getMain();
  const mainAlive = !!main && !main.isDestroyed();
  const show =
    mainAlive &&
    shouldShowOverlay(getConfig(), state, getLatestGames().length > 0);

  if (!show) {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible())
      overlay.hide();
    setThrottling(false);
    return;
  }

  if (!overlay || overlay.isDestroyed()) overlay = createOverlay();
  overlay.setBounds(boundsFor(getConfig().overlayCorner));
  setThrottling(true);
  push();
  // Never takes focus from the game
  if (!overlay.isVisible()) overlay.showInactive();
}

/**
 * Store a snapshot from the main window.
 *
 * @param value Untrusted payload
 */
export function setOverlayState(value: unknown) {
  state = sanitiseOverlayState(value);
  refreshOverlay();
}

/** Forget the call, e.g. after the main window navigated or reloaded. */
export function resetOverlay() {
  state = { inCall: false, participants: [] };
  refreshOverlay();
}

/** Close the overlay window for good, when the app window is gone. */
export function destroyOverlay() {
  state = { inCall: false, participants: [] };
  throttlingOff = false;
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = undefined;
}

/**
 * Start following display changes, call once the app is ready.
 *
 * @param main Gives the main window
 */
export function installOverlay(main: () => BrowserWindow | undefined) {
  getMain = main;
  const move = () => {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible())
      overlay.setBounds(boundsFor(getConfig().overlayCorner));
  };
  screen.on("display-metrics-changed", move);
  screen.on("display-added", move);
  screen.on("display-removed", move);
}
