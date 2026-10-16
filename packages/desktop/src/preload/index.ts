import { contextBridge, ipcRenderer } from "electron";

import {
  type AppInfo,
  type DesktopConfig,
  type ErrorInfo,
  type HotkeyBinding,
  type HotkeyCapabilities,
  type HotkeyResult,
  type OverlayRender,
  type OverlayState,
  type PickerRequest,
  type PickerSource,
  type RunningGame,
  type UpdaterState,
  IPC,
} from "../shared/ipc";

const info: AppInfo = ipcRenderer.sendSync(IPC.appInfo);
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args);

/** Callback the client registered for the next screen share request. */
let pickerCallback: ((sources: PickerSource[]) => void) | undefined;
/** Id of the request the client is currently choosing for. */
let pickerId: number | undefined;
ipcRenderer.on(IPC.pickerSources, (_event, request: PickerRequest) => {
  const callback = pickerCallback;
  pickerCallback = undefined;
  pickerId = request.id;
  if (callback) callback(request.sources);
  // Nobody is listening: cancel so the capture request doesn't hang
  else invoke(IPC.pickerResult, request.id, -1, false).catch(() => {});
});
// The shell gave up waiting, so a late answer would be ignored anyway
ipcRenderer.on(IPC.pickerCancel, (_event, id: number) => {
  if (pickerId === id) pickerId = undefined;
});

/** Cached settings, so the client can read them synchronously. */
const initialConfig: DesktopConfig | null = ipcRenderer.sendSync(
  IPC.configGetSync,
);
let configCache = initialConfig;

/** Subscribers to window maximise changes. */
const maximiseListeners = new Set<(maximised: boolean) => void>();
ipcRenderer.on(IPC.windowMaximised, (_event, maximised: boolean) => {
  if (configCache) configCache.windowState.isMaximised = maximised;
  maximiseListeners.forEach((listener) => listener(maximised));
});

/** Subscribers to global shortcut presses. */
const hotkeyListeners = new Set<(action: string) => void>();
ipcRenderer.on(IPC.hotkeyFired, (_event, action: string) => {
  hotkeyListeners.forEach((listener) => listener(action));
});

/** Subscribers to global shortcut releases. */
const hotkeyReleaseListeners = new Set<(action: string) => void>();
ipcRenderer.on(IPC.hotkeyReleased, (_event, action: string) => {
  hotkeyReleaseListeners.forEach((listener) => listener(action));
});

/** Subscribers to controller push-to-talk presses (true) and releases. */
const gamepadListeners = new Set<(down: boolean) => void>();
ipcRenderer.on(IPC.gamepadPtt, (_event, down: boolean) => {
  gamepadListeners.forEach((listener) => listener(down));
});

/** Subscribers to updater state changes. */
const updaterListeners = new Set<(state: UpdaterState) => void>();
ipcRenderer.on(IPC.updaterState, (_event, state: UpdaterState) => {
  updaterListeners.forEach((listener) => listener(state));
});

/** Subscribers to changes of the detected games. */
const gamesListeners = new Set<(games: RunningGame[]) => void>();
ipcRenderer.on(IPC.gamesChanged, (_event, games: RunningGame[]) => {
  gamesListeners.forEach((listener) => listener(games));
});

/** Expose the bridge the web client switches on. */
function exposeNative() {
  contextBridge.exposeInMainWorld("native", {
    versions: {
      node: () => process.versions.node,
      chrome: () => process.versions.chrome,
      electron: () => process.versions.electron,
      desktop: () => info.desktopVersion,
    },
    platform: info.platform,
    isWayland: () => info.isWayland,
    desktopEnvironment: info.desktopEnvironment,
    minimise: () => invoke(IPC.windowMinimise),
    maximise: () => invoke(IPC.windowMaximise),
    close: () => invoke(IPC.windowClose),
    onMaximiseChange: (callback: (maximised: boolean) => void) => {
      maximiseListeners.add(callback);
      return () => {
        maximiseListeners.delete(callback);
      };
    },
    onceScreenPicker: (callback: (sources: PickerSource[]) => void) => {
      pickerCallback = callback;
    },
    screenPickerCallback: (idx: number, audio: boolean) => {
      const id = pickerId;
      pickerId = undefined;
      if (id === undefined) return Promise.resolve();
      return invoke<void>(IPC.pickerResult, id, idx, audio).catch(() => {});
    },
    setGlobalHotkeys: (bindings: HotkeyBinding[]) =>
      invoke<HotkeyResult[]>(IPC.hotkeysSet, bindings),
    onGlobalHotkey: (callback: (action: string) => void) => {
      hotkeyListeners.add(callback);
      return () => {
        hotkeyListeners.delete(callback);
      };
    },
    onGlobalHotkeyRelease: (callback: (action: string) => void) => {
      hotkeyReleaseListeners.add(callback);
      return () => {
        hotkeyReleaseListeners.delete(callback);
      };
    },
    setGamepadPushToTalk: (button: string | null) =>
      invoke<boolean>(IPC.gamepadSet, button),
    onGamepadPushToTalk: (callback: (down: boolean) => void) => {
      gamepadListeners.add(callback);
      return () => {
        gamepadListeners.delete(callback);
      };
    },
    getHotkeyCapabilities: () =>
      invoke<HotkeyCapabilities>(IPC.hotkeyCapabilities),
    getRunningGames: () => invoke<RunningGame[]>(IPC.gamesGet),
    getFocusedGame: () =>
      invoke<{ id: string; sourceId: string } | null>(IPC.gamesFocused),
    onRunningGamesChanged: (callback: (games: RunningGame[]) => void) => {
      gamesListeners.add(callback);
      return () => {
        gamesListeners.delete(callback);
      };
    },
    // Present only in shells that have the overlay, the client checks for it
    setOverlayState: (state: OverlayState) =>
      invoke<void>(IPC.overlaySet, state),
    setNextScreenSource: (sourceId: string | null) =>
      invoke<void>(IPC.screenSourceSet, sourceId),
  });

  contextBridge.exposeInMainWorld("desktopConfig", {
    get: () => configCache as DesktopConfig,
    set: async (partial: Partial<DesktopConfig>) => {
      const next = await invoke<DesktopConfig>(IPC.configSet, partial);
      configCache = next;
      return next;
    },
    getAutostart: () => invoke<boolean>(IPC.autostartGet),
    setAutostart: (value: boolean) => invoke<boolean>(IPC.autostartSet, value),
    getDefaultServerUrl: () => invoke<string>(IPC.defaultUrl),
  });

  // Separate from `native` so the client can tell shells without updater
  contextBridge.exposeInMainWorld("desktopUpdater", {
    getState: () => invoke<UpdaterState>(IPC.updaterGetState),
    check: () => invoke<void>(IPC.updaterCheck),
    download: () => invoke<void>(IPC.updaterDownload),
    install: () => {
      invoke<void>(IPC.updaterInstall).catch(() => {});
    },
    onState: (callback: (state: UpdaterState) => void) => {
      updaterListeners.add(callback);
      return () => {
        updaterListeners.delete(callback);
      };
    },
  });
}

/** Expose the minimal bridge for the local error page. */
function exposeErrorPage() {
  contextBridge.exposeInMainWorld("anytalkError", {
    getInfo: () => invoke<ErrorInfo>(IPC.errorInfo),
    retry: () => invoke<void>(IPC.errorRetry),
    setServerUrl: (url: string) => invoke<boolean>(IPC.errorSetUrl, url),
    reset: () => invoke<void>(IPC.errorReset),
  });
}

/**
 * Expose the minimal bridge for the overlay page. The newest state is kept,
 * so a page that subscribes after it arrived still gets it.
 */
function exposeOverlayPage() {
  let latest: OverlayRender | undefined;
  const listeners = new Set<(state: OverlayRender) => void>();
  ipcRenderer.on(IPC.overlayState, (_event, state: OverlayRender) => {
    latest = state;
    listeners.forEach((listener) => listener(state));
  });
  contextBridge.exposeInMainWorld("anytalkOverlay", {
    onState: (callback: (state: OverlayRender) => void) => {
      listeners.add(callback);
      if (latest) callback(latest);
    },
  });
}

if (location.href.split(/[?#]/)[0] === info.errorPageUrl) {
  exposeErrorPage();
} else if (location.href.split(/[?#]/)[0] === info.overlayPageUrl) {
  exposeOverlayPage();
} else if (
  // a stream popout inherits the opener's origin but never gets the bridge
  !window.opener &&
  !window.name.startsWith("anytalk-stream-popout") &&
  location.origin === info.origin
) {
  // Without the synchronous config the page can't tell it runs in the app
  if (configCache) exposeNative();
}
