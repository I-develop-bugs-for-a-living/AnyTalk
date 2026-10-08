import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  session,
  shell,
} from "electron";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type AppInfo,
  type DesktopConfig,
  type ErrorInfo,
  CLIENT_WRITABLE_KEYS,
  IPC,
} from "../shared/ipc";
import { getAutostart, setAutostart } from "./autostart";
import { getConfig, updateConfig } from "./config";
import { ensureLinuxDesktopFile } from "./desktopFile";
import { resetGlobalHotkeys, setGlobalHotkeys } from "./hotkeys";
import { APP_ID, desktopEnvironment, isWayland } from "./platform";
import { installScreenShare } from "./screen";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  installUpdate,
  setAutoUpdate,
  startUpdater,
} from "./updater";
import {
  DEFAULT_URL,
  effectiveUrl,
  isServerUrl,
  parseHttpUrl,
  serverOrigin,
} from "./url";

/** Permissions the server origin may use. */
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "notifications",
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
  "display-capture",
  "speaker-selection",
  "screen-wake-lock",
]);

const errorPagePath = join(__dirname, "error-page", "index.html");
const errorPageUrl = pathToFileURL(errorPagePath).toString();

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
/** Set once a real quit began, so the close handler stops hiding to tray. */
let quitting = false;
/** Whether a StatusNotifier host (system tray) exists, see `detectTray`. */
let trayAvailable = true;
let lastFailure: ErrorInfo | undefined;
/** Whether a downloaded update waits for a restart, see `startUpdater`. */
let updateReady = false;

// Chromium switches must be set before the app is ready
if (!getConfig().hardwareAcceleration) app.disableHardwareAcceleration();
if (process.platform === "linux") {
  // Run natively on Wayland, use PipeWire capture and the shortcuts portal
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch(
    "enable-features",
    "WebRTCPipeWireCapturer,GlobalShortcutsPortal",
  );
}
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
if (process.platform === "linux") {
  // The shortcuts portal identifies the app by this desktop file name, and
  // rejects ids that aren't reverse-DNS or have no desktop file behind them
  app.setDesktopName(`${APP_ID}.desktop`);
  ensureLinuxDesktopFile();
}

/** Static facts handed to the preload. */
function appInfo(): AppInfo {
  return {
    origin: serverOrigin(),
    platform: process.platform as AppInfo["platform"],
    isWayland,
    desktopEnvironment,
    desktopVersion: app.getVersion(),
    errorPageUrl,
  };
}

/** Whether an IPC message came from the app page's top frame. */
function fromApp(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  const frame = event.senderFrame;
  return (
    !!frame &&
    frame === event.sender.mainFrame &&
    event.sender === mainWindow?.webContents &&
    isServerUrl(frame.url)
  );
}

/** Whether an IPC message came from our local error page. */
function fromErrorPage(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
) {
  const frame = event.senderFrame;
  return (
    !!frame &&
    frame === event.sender.mainFrame &&
    event.sender === mainWindow?.webContents &&
    frame.url.split(/[?#]/)[0] === errorPageUrl
  );
}

/**
 * Run `dbus-send` against the session bus.
 *
 * @param args Arguments after `--session --print-reply`
 * @returns The reply text, or undefined if the tool or bus isn't there
 */
function dbusCall(args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "dbus-send",
      ["--session", "--print-reply", ...args],
      { timeout: 2000 },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

/**
 * Whether the session has a system tray to restore a hidden window from.
 * GNOME without the AppIndicator extension has none, and a hidden window
 * would be lost there. If the check itself fails we assume a tray exists.
 *
 * @returns False only when we are sure there is no tray host
 */
async function detectTray(): Promise<boolean> {
  if (process.platform !== "linux") return true;

  const owned = await dbusCall([
    "--dest=org.freedesktop.DBus",
    "/org/freedesktop/DBus",
    "org.freedesktop.DBus.NameHasOwner",
    "string:org.kde.StatusNotifierWatcher",
  ]);
  if (owned === undefined) return true;
  if (!owned.includes("boolean true")) return false;

  const host = await dbusCall([
    "--dest=org.kde.StatusNotifierWatcher",
    "/StatusNotifierWatcher",
    "org.freedesktop.DBus.Properties.Get",
    "string:org.kde.StatusNotifierWatcher",
    "string:IsStatusNotifierHostRegistered",
  ]);
  return host === undefined || host.includes("boolean true");
}

/** Show and focus the window, recreating it if needed. */
function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Load the configured server, falling back to the error page on failure. */
function loadApp() {
  lastFailure = undefined;
  mainWindow?.loadURL(effectiveUrl()).catch(() => {
    // did-fail-load shows the error page
  });
}

/** Load the bundled error page. */
function showErrorPage() {
  mainWindow?.loadFile(errorPagePath).catch(() => {});
}

/** Quit for real (tray menu, app menu). */
function quitApp() {
  quitting = true;
  app.quit();
}

/** Restart into the downloaded update (tray menu, app menu). */
function restartToUpdate() {
  // Set first so the close handler doesn't hide the window instead of quitting
  quitting = true;
  try {
    installUpdate();
  } catch (error) {
    quitting = false;
    console.error("[updater] could not restart to update:", error);
  }
}

/** Create the main window with the saved size and frame style. */
function createWindow() {
  const config = getConfig();
  const state = config.windowState;
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 400,
    minHeight: 300,
    show: false,
    frame: !config.customFrame,
    autoHideMenuBar: true,
    backgroundColor: "#1a1a1a",
    title: "AnyTalk",
    // the .ico gives Windows the sharp taskbar icon, Linux takes the png
    icon: nativeImage.createFromPath(
      join(__dirname, process.platform === "win32" ? "icon.ico" : "icon.png"),
    ),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: config.spellchecker,
    },
  });
  mainWindow = win;

  if (state.isMaximised) win.maximize();
  win.once("ready-to-show", () => {
    if (!config.startMinimisedToTray) return win.show();
    // Without a tray the window can't be hidden, so start minimised instead
    if (!trayAvailable) {
      win.showInactive();
      win.minimize();
    }
  });

  // Remember size and position (debounced) and the maximised state
  let saveTimer: NodeJS.Timeout | undefined;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
      const { x, y, width, height } = win.getBounds();
      updateConfig({
        windowState: { ...getConfig().windowState, x, y, width, height },
      });
    }, 500);
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  const saveMax = () =>
    updateConfig({
      windowState: {
        ...getConfig().windowState,
        isMaximised: win.isMaximized(),
      },
    });
  win.on("maximize", () => {
    saveMax();
    win.webContents.send(IPC.windowMaximised, true);
  });
  win.on("unmaximize", () => {
    saveMax();
    win.webContents.send(IPC.windowMaximised, false);
  });

  win.on("close", (event) => {
    if (!quitting && getConfig().minimiseToTray) {
      event.preventDefault();
      // Hiding is only safe if the tray can bring the window back
      if (trayAvailable) win.hide();
      else win.minimize();
    }
  });
  // Windows asks open windows to close at logoff, don't block it
  win.on("session-end", () => {
    quitting = true;
  });
  win.on("closed", () => {
    mainWindow = undefined;
  });

  const wc = win.webContents;

  // Keep the server in-app, send everything else to the browser
  const keepInApp = (event: Electron.Event, url: string) => {
    if (isServerUrl(url) || url.split(/[?#]/)[0] === errorPageUrl) return;
    event.preventDefault();
    if (parseHttpUrl(url)) shell.openExternal(url);
  };
  wc.on("will-navigate", keepInApp);
  wc.on("will-redirect", keepInApp);
  // A reload or server switch starts a new page that registers its own
  // hotkeys, so drop the old ones instead of leaving them firing into nothing
  wc.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      globalShortcut.unregisterAll();
      resetGlobalHotkeys();
    }
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (parseHttpUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // -3 is ABORTED (a newer navigation replaced this one)
    if (!isMainFrame || code === -3 || url.startsWith("file:")) return;
    lastFailure = { url, reason: description, defaultUrl: DEFAULT_URL };
    showErrorPage();
  });

  // Spelling suggestions and basic edit actions
  wc.on("context-menu", (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items: Electron.MenuItemConstructorOptions[] = [];
    for (const word of params.dictionarySuggestions) {
      items.push({ label: word, click: () => wc.replaceMisspelling(word) });
    }
    if (params.misspelledWord) {
      items.push({
        label: `Add "${params.misspelledWord}" to dictionary`,
        click: () =>
          wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
    }
    if (items.length) items.push({ type: "separator" });
    items.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll" },
    );
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  loadApp();
  return win;
}

/** Build the tray menu, with "Restart to update" once an update is ready. */
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Show AnyTalk", click: showWindow },
    ...(updateReady
      ? [{ label: "Restart to update", click: restartToUpdate }]
      : []),
    {
      label: "Reset server URL",
      click: () => {
        updateConfig({ serverUrl: "" });
        showWindow();
        loadApp();
      },
    },
    { type: "separator" as const },
    { label: "Quit", click: quitApp },
  ]);
}

/** Create the tray icon and its menu. */
function createTray() {
  const icon = nativeImage
    .createFromPath(join(__dirname, "icon.png"))
    .resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip("AnyTalk");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showWindow();
  });
}

/** Application menu, mostly for keyboard shortcuts with a frameless window. */
function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          ...(updateReady
            ? [{ label: "Restart to update", click: restartToUpdate }]
            : []),
          { label: "Quit", accelerator: "CmdOrCtrl+Q", click: quitApp },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

/** Register IPC handlers, each validating its sender. */
function registerIpc() {
  ipcMain.on(IPC.configGetSync, (event) => {
    // Sync so the page can read settings without waiting, null if untrusted
    event.returnValue = fromApp(event) ? getConfig() : null;
  });
  ipcMain.on(IPC.appInfo, (event) => {
    // Preload asks synchronously before it knows the page is trusted
    event.returnValue = appInfo();
  });

  /** Register a handler that ignores messages from other senders. */
  const handleApp = <A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => R,
  ) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromApp(event)) throw new Error("Untrusted sender");
      return fn(...(args as A));
    });

  handleApp(IPC.configGet, () => getConfig());
  handleApp(IPC.defaultUrl, () => DEFAULT_URL);
  handleApp(IPC.configSet, (partial: Partial<DesktopConfig>) => {
    if (typeof partial !== "object" || partial === null) return getConfig();
    const previousUrl = getConfig().serverUrl;
    // Only whitelisted keys with the right type, never firstLaunch or
    // windowState, which the shell manages itself
    const update: Record<string, unknown> = {};
    for (const key of CLIENT_WRITABLE_KEYS) {
      const value = (partial as Record<string, unknown>)[key];
      if (typeof value === typeof getConfig()[key]) update[key] = value;
    }
    if (typeof update.serverUrl === "string") {
      const raw = update.serverUrl.trim();
      if (raw === "") update.serverUrl = "";
      else {
        // http stays allowed for servers on the local network
        const valid = parseHttpUrl(raw);
        if (!valid) throw new Error("Server URL must be http(s)");
        update.serverUrl = valid;
      }
    }
    const next = updateConfig(update as Partial<DesktopConfig>);
    mainWindow?.webContents.session.setSpellCheckerEnabled(next.spellchecker);
    setAutoUpdate(next.autoUpdate);
    if (next.serverUrl !== previousUrl) loadApp();
    return next;
  });
  handleApp(IPC.updaterGetState, () => getUpdaterState());
  handleApp(IPC.updaterCheck, () => checkForUpdates());
  handleApp(IPC.updaterDownload, () => downloadUpdate());
  handleApp(IPC.updaterInstall, () => {
    // Only once downloaded, same path as the tray item
    if (getUpdaterState().status === "downloaded") restartToUpdate();
  });
  handleApp(IPC.autostartGet, () => getAutostart());
  handleApp(IPC.autostartSet, (value: boolean) => setAutostart(value === true));

  handleApp(IPC.windowMinimise, () => mainWindow?.minimize());
  handleApp(IPC.windowMaximise, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  // Same as the window's close button, so tray hiding applies
  handleApp(IPC.windowClose, () => mainWindow?.close());

  handleApp(IPC.hotkeysSet, (bindings: unknown) => {
    const list = (Array.isArray(bindings) ? bindings : []).filter(
      (b): b is { action: string; accelerator: string } =>
        typeof b?.action === "string" && typeof b?.accelerator === "string",
    );
    return setGlobalHotkeys(list, (action) =>
      mainWindow?.webContents.send(IPC.hotkeyFired, action),
    );
  });

  /** Register an error page handler. */
  const handleError = <A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => R,
  ) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromErrorPage(event)) throw new Error("Untrusted sender");
      return fn(...(args as A));
    });

  handleError(
    IPC.errorInfo,
    (): ErrorInfo =>
      lastFailure ?? {
        url: effectiveUrl(),
        reason: "",
        defaultUrl: DEFAULT_URL,
      },
  );
  handleError(IPC.errorRetry, () => loadApp());
  handleError(IPC.errorSetUrl, (value: string) => {
    const valid = parseHttpUrl(String(value));
    if (!valid) return false;
    updateConfig({ serverUrl: valid });
    loadApp();
    return true;
  });
  handleError(IPC.errorReset, () => {
    updateConfig({ serverUrl: "" });
    loadApp();
  });
}

/** Only the server origin may use powerful permissions. */
function installPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(
      ALLOWED_PERMISSIONS.has(permission) &&
        wc === mainWindow?.webContents &&
        isServerUrl(details.requestingUrl),
    );
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    return (
      ALLOWED_PERMISSIONS.has(permission) &&
      wc === mainWindow?.webContents &&
      isServerUrl(requestingOrigin)
    );
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  // Every way a real quit can start, so closing to tray never blocks it
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    quitting = true;
    globalShortcut.unregisterAll();
  });
  // With minimise to tray off, closing the last window quits
  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(async () => {
    powerMonitor.on("shutdown", () => {
      quitting = true;
    });
    trayAvailable = await detectTray();
    session.defaultSession.setSpellCheckerEnabled(getConfig().spellchecker);
    registerIpc();
    installPermissions();
    installScreenShare(fromApp);
    createMenu();
    if (trayAvailable) createTray();
    // On every launch, before the first page load: a service worker from an
    // older web build would keep serving its old cached code, so start from
    // none. The HTTP cache, cookies and local
    // storage stay, so login and settings survive.
    await session.defaultSession
      .clearStorageData({ storages: ["serviceworkers", "cachestorage"] })
      .catch(() => {});
    createWindow();
    startUpdater(getConfig().autoUpdate, () => {
      // Menus are static, so rebuild them with the restart item
      updateReady = true;
      tray?.setContextMenu(buildTrayMenu());
      createMenu();
    });
    if (getConfig().firstLaunch) updateConfig({ firstLaunch: false });
  });
}
