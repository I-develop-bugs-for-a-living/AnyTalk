import { contextBridge, ipcRenderer } from "electron";

import {
  type AppInfo,
  type DesktopConfig,
  type ErrorInfo,
  type HotkeyBinding,
  type HotkeyResult,
  type PickerRequest,
  type PickerSource,
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

/** Subscribers to updater state changes. */
const updaterListeners = new Set<(state: UpdaterState) => void>();
ipcRenderer.on(IPC.updaterState, (_event, state: UpdaterState) => {
  updaterListeners.forEach((listener) => listener(state));
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

if (location.href.split(/[?#]/)[0] === info.errorPageUrl) {
  exposeErrorPage();
} else if (location.origin === info.origin) {
  // Without the synchronous config the page can't tell it runs in the app
  if (configCache) exposeNative();
}
