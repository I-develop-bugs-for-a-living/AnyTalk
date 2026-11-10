import { desktopCapturer, ipcMain, session, webContents } from "electron";

import { type PickerRequest, type PickerSource, IPC } from "../shared/ipc";
import { gameLog } from "./gameLog";
import { isGameWindow } from "./games";
import { isWayland } from "./platform";
import { isServerUrl } from "./url";

/** How long to wait for the user to choose before giving up. */
const PICKER_TIMEOUT_MS = 120_000;

/** The one picker request waiting for the user's choice. */
type PendingPicker = {
  id: number;
  sender: Electron.WebContents;
  finish: (value?: { idx: number; audio: boolean }) => void;
  /** Every source offered so far by index, indexes are never reused */
  known: Map<number, Electron.DesktopCapturerSource>;
  /** Index handed out per source id, so a source keeps its index on refresh */
  indexOf: Map<string, number>;
  /** Whether a refresh is running, refreshes never overlap */
  refreshing: boolean;
};

/**
 * Turn captured sources into the picker's list. Each source keeps the index
 * it got first, so a choice made against an older list still hits it.
 *
 * @param request The open picker request
 * @param sources Sources just captured
 * @returns The list for the page
 */
function toPickerSources(
  request: PendingPicker,
  sources: Electron.DesktopCapturerSource[],
): PickerSource[] {
  return sources.map((source) => {
    let idx = request.indexOf.get(source.id);
    if (idx === undefined) {
      idx = request.indexOf.size;
      request.indexOf.set(source.id, idx);
    }
    request.known.set(idx, source);
    return {
      idx,
      name: source.name,
      isFullScreen: source.id.startsWith("screen:"),
      image: source.thumbnail.isEmpty()
        ? source.appIcon?.toDataURL()
        : source.thumbnail.toDataURL(),
    };
  });
}

/** How long a preselected source stays valid. */
const PRESELECT_TTL_MS = 10_000;

/** One-shot source chosen ahead of the next capture request. */
let preselected: { sourceId: string; expires: number } | undefined;

/**
 * Remember a source for the next display-media request, which then skips
 * the picker. It is used once and expires after a few seconds.
 *
 * @param sourceId A `desktopCapturer` source id, or null to clear
 */
export function setNextScreenSource(sourceId: string | null) {
  preselected =
    typeof sourceId === "string" && sourceId !== ""
      ? { sourceId, expires: Date.now() + PRESELECT_TTL_MS }
      : undefined;
}

let pending: PendingPicker | undefined;
let nextId = 1;

/**
 * Ask the page's picker modal which source to capture. Only one request can
 * be open at a time, a second one is cancelled right away.
 *
 * @param sender The renderer that asked for screen capture
 * @param sources Sources to offer
 * @returns The chosen source and audio flag, or undefined on
 * cancel/timeout/busy
 */
function askRenderer(
  sender: Electron.WebContents,
  sources: Electron.DesktopCapturerSource[],
): Promise<
  { source: Electron.DesktopCapturerSource; audio: boolean } | undefined
> {
  if (pending) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    const id = nextId++;
    const request: PendingPicker = {
      id,
      sender,
      known: new Map(),
      indexOf: new Map(),
      refreshing: false,
      finish: (value) => {
        clearTimeout(timer);
        if (pending?.id === id) pending = undefined;
        resolve(
          value && request.known.has(value.idx)
            ? { source: request.known.get(value.idx)!, audio: value.audio }
            : undefined,
        );
      },
    };
    // On timeout the page is told to forget the request, its modal can't be
    // closed from here, so a late answer is simply ignored
    const timer = setTimeout(() => {
      if (!sender.isDestroyed()) sender.send(IPC.pickerCancel, id);
      request.finish();
    }, PICKER_TIMEOUT_MS);

    pending = request;
    sender.send(IPC.pickerSources, {
      id,
      sources: toPickerSources(request, sources),
    } satisfies PickerRequest);
  });
}

/**
 * Install the handler that answers getDisplayMedia() requests.
 *
 * On X11 and Windows we gather sources and let the client's own picker
 * choose. On Wayland, getSources() itself opens the xdg portal picker and
 * returns only what the user picked, so we take that and skip our picker.
 * System audio loopback is only offered on Windows.
 *
 * @param isTrusted Whether an IPC message comes from the app page
 */
export function installScreenShare(
  isTrusted: (event: Electron.IpcMainInvokeEvent) => boolean,
) {
  // One handler for all requests, it only answers the pending one
  ipcMain.handle(
    IPC.pickerResult,
    (event, id: unknown, idx: unknown, audio: unknown) => {
      if (!isTrusted(event) || !pending) return;
      if (id !== pending.id || event.sender !== pending.sender) return;
      pending.finish(
        typeof idx === "number" && idx >= 0
          ? { idx, audio: audio === true }
          : undefined,
      );
    },
  );

  // The picker polls this while it is open, so windows that appear after it
  // opened (e.g. a game that lost focus to the picker) show up. Polls skip
  // the expensive thumbnails unless asked, and never overlap.
  ipcMain.handle(
    IPC.pickerRefresh,
    async (event, id: unknown, thumbnails: unknown) => {
      const request = pending;
      if (!isTrusted(event) || !request) return null;
      if (id !== request.id || event.sender !== request.sender) return null;
      if (request.refreshing) return null;
      request.refreshing = true;
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize:
            thumbnails === true
              ? { width: 192, height: 108 }
              : { width: 0, height: 0 },
          fetchWindowIcons: true,
        });
        // The picker may have closed while this was running
        if (pending !== request) return null;
        return toPickerSources(request, sources);
      } catch (error) {
        gameLog(`Picker refresh failed: ${String(error)}`);
        return null;
      } finally {
        request.refreshing = false;
      }
    },
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        if (!request.frame || !isServerUrl(request.frame.url))
          return callback({});

        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 192, height: 108 },
          fetchWindowIcons: true,
        });
        if (sources.length === 0) return callback({});

        const audioFor = (wanted: boolean) =>
          wanted && process.platform === "win32" ? "loopback" : undefined;

        if (isWayland) {
          return callback({
            video: sources[0],
            audio: audioFor(request.audioRequested),
          });
        }

        // A preselection is consumed by this request. If its window is gone
        // the request is cancelled, never answered with the picker, so a
        // follow swap mid-game can't pop it up. An expired one is ignored.
        const wanted = preselected;
        preselected = undefined;
        if (wanted && wanted.expires > Date.now()) {
          const preset = isGameWindow(wanted.sourceId)
            ? sources.find((source) => source.id === wanted.sourceId)
            : undefined;
          gameLog(
            `Preselect ${wanted.sourceId}: isGameWindow ${isGameWindow(wanted.sourceId)}, found ${!!preset}, ` +
              (preset ? "captured" : "cancelled"),
          );
          if (!preset) return callback({});
          return callback({
            video: preset,
            audio: audioFor(request.audioRequested),
          });
        }

        const sender = webContents.fromFrame(request.frame);
        if (!sender) return callback({});

        const choice = await askRenderer(sender, sources);
        if (!choice) return callback({});
        callback({
          video: choice.source,
          audio: audioFor(choice.audio && request.audioRequested),
        });
      } catch (error) {
        console.error("Screen share failed", error);
        gameLog(`Screen share failed: ${String(error)}`);
        callback({});
      }
    },
  );
}
