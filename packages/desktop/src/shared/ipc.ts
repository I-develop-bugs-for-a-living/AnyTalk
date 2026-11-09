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
  tlsKeyLogGet: "tlskeylog:get",
  tlsKeyLogSet: "tlskeylog:set",
  tlsKeyLogReveal: "tlskeylog:reveal",
  requestWatchSet: "requestwatch:set",
  requestsSeen: "requestwatch:seen",
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

/** When one overlay element shows: always, only while speaking, or never. */
export const OVERLAY_VISIBILITIES = ["always", "speaking", "off"] as const;
/** See `OVERLAY_VISIBILITIES`. */
export type OverlayVisibility = (typeof OVERLAY_VISIBILITIES)[number];

/** The overlay elements the user can set a visibility for. */
export const OVERLAY_ELEMENT_KEYS = [
  "overlayAvatar",
  "overlayName",
  "overlayLive",
  "overlayStatus",
  "overlayWatching",
] as const;
/** Config key of one overlay element. */
export type OverlayElementKey = (typeof OVERLAY_ELEMENT_KEYS)[number];

/** Visibility of every overlay element. */
export type OverlayElements = Record<OverlayElementKey, OverlayVisibility>;

/** One call participant as drawn by the overlay. */
export type OverlayParticipant = {
  id: string;
  name: string;
  /** Remote image URL */
  avatar?: string;
  speaking: boolean;
  streaming: boolean;
  /** Microphone off */
  muted: boolean;
  /** Deafened, shown instead of the muted badge */
  deafened: boolean;
  /** Watching the local user's stream */
  watchingYou: boolean;
};

/** Call snapshot the main window sends and the overlay draws. */
export type OverlayState = {
  inCall: boolean;
  /** Translated text of the LIVE tag, the page falls back to "LIVE" */
  liveLabel?: string;
  /** Translated labels of the muted and deafened badges */
  mutedLabel?: string;
  deafenedLabel?: string;
  /** Translated text of the "watching your stream" eye */
  watchingLabel?: string;
  participants: OverlayParticipant[];
};

/** What the overlay page receives: the call snapshot plus the look. */
export type OverlayRender = OverlayState & {
  elements: OverlayElements;
  corner: OverlayCorner;
};

/** Settings persisted by the desktop shell. */
export type DesktopConfig = OverlayElements & {
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
  /** Custom server URL, empty string means the default */
  serverUrl: string;
  /** Write the TLS session keys of this app to a file (network inspector) */
  tlsKeyLog: boolean;
  /** App version the key log was switched on in, it resets on an update */
  tlsKeyLogVersion: string;
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
  ...OVERLAY_ELEMENT_KEYS,
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

/** State of the TLS key log option, see `main/tlsKeyLog.ts`. */
export type TlsKeyLogState = {
  /** The setting: on from the next start */
  enabled: boolean;
  /** Keys are being written in this session */
  active: boolean;
  /** Where the keys are written, whether or not the file exists yet */
  path: string;
  /** The file exists */
  exists: boolean;
};

/** What the user chose when switching the TLS key log on. */
export type TlsKeyLogResult = TlsKeyLogState & {
  /** The user chose "Restart now": the app is restarting */
  restarting: boolean;
};

/**
 * A request the desktop session saw that the page's own recorder cannot see
 * (see `main/requestWatch.ts`). Header values are raw: the page redacts them.
 */
export type DesktopRequest = {
  /** Chromium's request id, unique within the session */
  id: number;
  method: string;
  url: string;
  /** Chromium resource type: image, script, font, media, mainFrame, ... */
  resourceType: string;
  /** Epoch milliseconds when the request was sent */
  start: number;
  /** Epoch milliseconds when it finished or failed */
  end: number;
  /** Not tied to a page: main process, updater or service worker */
  background: boolean;
  requestHeaders: [name: string, value: string][];
  status?: number;
  statusLine?: string;
  responseHeaders: [name: string, value: string][];
  fromCache: boolean;
  /** Chromium error code (`net::ERR_...`) when it failed */
  error?: string;
  /** Server address as Chromium connected to it */
  ip?: string;
};
