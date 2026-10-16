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
  hotkeyReleased: "hotkeys:released",
  hotkeyCapabilities: "hotkeys:capabilities",
  gamepadSet: "gamepad:set",
  gamepadPtt: "gamepad:ptt",
  pickerSources: "picker:sources",
  pickerResult: "picker:result",
  pickerCancel: "picker:cancel",
  gamesGet: "games:get",
  gamesChanged: "games:changed",
  gamesFocused: "games:focused",
  screenSourceSet: "screen:source-set",
  errorInfo: "error:info",
  errorRetry: "error:retry",
  errorSetUrl: "error:set-url",
  errorReset: "error:reset",
  updaterGetState: "updater:get-state",
  updaterCheck: "updater:check",
  updaterDownload: "updater:download",
  updaterInstall: "updater:install",
  updaterState: "updater:state",
  overlaySet: "overlay:set",
  overlayState: "overlay:state",
} as const;

/** Screen corners the overlay can sit in. */
export const OVERLAY_CORNERS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;
/** A corner of the screen. */
export type OverlayCorner = (typeof OVERLAY_CORNERS)[number];

/** When the overlay shows: in every call, or only next to a detected game. */
export const OVERLAY_MODES = ["always", "games"] as const;
/** See `OVERLAY_MODES`. */
export type OverlayMode = (typeof OVERLAY_MODES)[number];

/** Overlay looks: avatars only, or with names and the LIVE tag. */
export const OVERLAY_STYLES = ["compact", "detailed"] as const;
/** See `OVERLAY_STYLES`. */
export type OverlayStyle = (typeof OVERLAY_STYLES)[number];

/** One call participant as drawn by the overlay. */
export type OverlayParticipant = {
  id: string;
  name: string;
  /** Remote image URL */
  avatar?: string;
  speaking: boolean;
  streaming: boolean;
};

/** Call snapshot the main window sends and the overlay draws. */
export type OverlayState = {
  inCall: boolean;
  /** Translated text of the LIVE tag, the page falls back to "LIVE" */
  liveLabel?: string;
  participants: OverlayParticipant[];
};

/** What the overlay page receives: the call snapshot plus the look. */
export type OverlayRender = OverlayState & {
  style: OverlayStyle;
  corner: OverlayCorner;
};

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
  /** Look for running games, see `RunningGame` */
  gameDetection: boolean;
  /** Show the in-game voice overlay */
  overlayEnabled: boolean;
  /** Screen corner of the overlay */
  overlayCorner: OverlayCorner;
  /** When the overlay shows */
  overlayMode: OverlayMode;
  /** How much the overlay shows */
  overlayStyle: OverlayStyle;
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
  "gameDetection",
  "overlayEnabled",
  "overlayCorner",
  "overlayMode",
  "overlayStyle",
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
  overlayPageUrl: string;
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

/** A capturable window that belongs to a detected game. */
export type RunningGameWindow = {
  /** The `desktopCapturer` source id, `window:...` */
  sourceId: string;
  title: string;
  role: "game" | "client";
};

/**
 * A detected game. Only matched games cross the bridge, never the raw
 * process or window list. `windows` is ordered by priority (role "game"
 * first) and may be empty.
 */
export type RunningGame = {
  id: string;
  name: string;
  windows: RunningGameWindow[];
};

/** A global shortcut binding requested by the client. */
export type HotkeyBinding = {
  action: string;
  accelerator: string;
  /** `KeyboardEvent.code` of the main key, layout independent */
  code?: string;
};

/** Outcome of registering a global shortcut. */
export type HotkeyResult = { action: string; registered: boolean };

/** What the hotkey backend can do, see `getHotkeyCapabilities`. */
export type HotkeyCapabilities = {
  /** Key releases are reported (keyboard hook), for push-to-talk */
  release: boolean;
  /** A controller button can act as push-to-talk (Windows, XInput) */
  gamepad: boolean;
};

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
