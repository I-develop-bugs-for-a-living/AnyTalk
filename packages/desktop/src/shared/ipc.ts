/** IPC channel names shared by the main process and the preload script. */
export const IPC = {
  appInfo: "app:info",
  configGet: "config:get",
  configGetSync: "config:get-sync",
  configSet: "config:set",
  defaultUrl: "config:default-url",
  autostartGet: "autostart:get",
  autostartSet: "autostart:set",
  windowMinimise: "window:minimise",
  windowMaximise: "window:maximise",
  windowClose: "window:close",
  windowMaximised: "window:maximised",
  hotkeysSet: "hotkeys:set",
  hotkeyFired: "hotkeys:fired",
  pickerSources: "picker:sources",
  pickerResult: "picker:result",
  pickerCancel: "picker:cancel",
  errorInfo: "error:info",
  errorRetry: "error:retry",
  errorSetUrl: "error:set-url",
  errorReset: "error:reset",
  updaterGetState: "updater:get-state",
  updaterCheck: "updater:check",
  updaterDownload: "updater:download",
  updaterInstall: "updater:install",
  updaterState: "updater:state",
} as const;

/** Settings persisted by the desktop shell. */
export type DesktopConfig = {
  firstLaunch: boolean;
  customFrame: boolean;
  minimiseToTray: boolean;
  startMinimisedToTray: boolean;
  spellchecker: boolean;
  hardwareAcceleration: boolean;
  discordRpc: boolean;
  /** Download updates automatically and install them on quit */
  autoUpdate: boolean;
  /** Custom server URL, empty string means the default */
  serverUrl: string;
  windowState: {
    isMaximised: boolean;
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
};

/** Settings the web client may change through `desktopConfig.set()`. */
export const CLIENT_WRITABLE_KEYS = [
  "customFrame",
  "minimiseToTray",
  "startMinimisedToTray",
  "spellchecker",
  "hardwareAcceleration",
  "discordRpc",
  "autoUpdate",
  "serverUrl",
] as const;

/** Static facts about the app, handed to the preload synchronously. */
export type AppInfo = {
  origin: string;
  platform: "win32" | "linux" | "darwin";
  isWayland: boolean;
  desktopEnvironment: string;
  desktopVersion: string;
  errorPageUrl: string;
};

/** A screen or window offered in the client's picker. */
export type PickerSource = {
  idx: number;
  name: string;
  isFullScreen: boolean;
  image?: string;
};

/** A screen picker request sent to the page. */
export type PickerRequest = { id: number; sources: PickerSource[] };

/** A global shortcut binding requested by the client. */
export type HotkeyBinding = { action: string; accelerator: string };

/** Outcome of registering a global shortcut. */
export type HotkeyResult = { action: string; registered: boolean };

/** What the error page shows. */
export type ErrorInfo = {
  url: string;
  reason: string;
  defaultUrl: string;
};

/** Where the self-updater currently is, see `UpdaterState`. */
export type UpdaterStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

/** Updater state shared with the client through `window.desktopUpdater`. */
export interface UpdaterState {
  status: UpdaterStatus;
  /** Available or downloaded version */
  version?: string;
  /** Download progress, 0-100, only while downloading */
  percent?: number;
  /** Short message, only for the "error" status */
  error?: string;
}
