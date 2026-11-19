import { app, ipcMain } from "electron";

import { IPC } from "../shared/ipc";
import { type AppAudioCapture, loadAppAudio } from "./appAudio";
import { isUwpHost, windowHandleFromSourceId } from "./appAudioLogic";
import { gameLog } from "./gameLog";
import type { AppCapture } from "./screenAudio";

/** How long a started capture waits for the page to attach before it stops. */
const ATTACH_TIMEOUT_MS = 15_000;

/** The one running per-process capture of the current share. */
type Share = {
  /** Ties page messages to this capture, never reused */
  id: number;
  sender: Electron.WebContents;
  capture: AppAudioCapture;
  /** Whether the page listens, chunks before that are dropped */
  attached: boolean;
  /** Stops the capture if the page never attaches */
  timer: ReturnType<typeof setTimeout>;
  /** Removes the listeners that end the capture with its page */
  unlisten: () => void;
};

/** The running capture, if any. */
let current: Share | undefined;

/** Number of the newest capture. */
let nextId = 1;

/**
 * Work out what per-process capture can do for window sources. The process
 * ids of AnyTalk itself are collected once per call, so a list of sources
 * doesn't ask for them again for each entry.
 *
 * @returns A lookup by source id, or undefined when the add-on is missing or
 * unsupported (callers then keep the loopback-only rules)
 */
export function appCaptureLookup():
  | ((sourceId: string) => AppCapture | undefined)
  | undefined {
  const addon = loadAppAudio();
  if (!addon) return undefined;
  const ownPids = [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
  let nameFailureLogged = false;
  return (sourceId) => {
    const hwnd = windowHandleFromSourceId(sourceId);
    if (hwnd === undefined) return undefined;
    let pid: number;
    try {
      pid = addon.processIdForWindow(hwnd);
    } catch {
      // a window that closed meanwhile has no process any more
      return { pid: undefined, ownPids, uwpHost: false };
    }
    let uwpHost = false;
    try {
      uwpHost = isUwpHost(addon.processImageName(pid));
    } catch (error) {
      // without the name a UWP window can't be told apart, the process is
      // then captured like any other
      if (!nameFailureLogged) {
        nameFailureLogged = true;
        gameLog(`Reading a process name failed: ${String(error)}`);
      }
    }
    return { pid, ownPids, uwpHost };
  };
}

/**
 * Stop the running capture and drop everything that belongs to it.
 *
 * @param notify Message to tell the capture's page (which then ends its
 * audio track), for a capture that ends without the page asking
 */
export function stopAppShare(notify?: string) {
  const share = current;
  if (!share) return;
  current = undefined;
  if (notify !== undefined && !share.sender.isDestroyed())
    share.sender.send(IPC.appAudioEnded, share.id, notify);
  clearTimeout(share.timer);
  share.unlisten();
  try {
    share.capture.stop();
  } catch (error) {
    gameLog(`Stopping app audio failed: ${String(error)}`);
  }
}

/**
 * Start capturing a process's sound for the page that asked for the share.
 * Chunks are only sent once the page attaches (`IPC.appAudioAttach`). Any
 * earlier capture ends first.
 *
 * @param sender The page that gets the sound
 * @param pid The process to capture
 * @returns Whether it started, false means the caller falls back
 */
export function startAppShare(
  sender: Electron.WebContents | undefined,
  pid: number,
): boolean {
  stopAppShare("replaced by a new share");
  const addon = loadAppAudio();
  if (!addon || !sender || sender.isDestroyed()) return false;
  const id = nextId++;
  try {
    const capture = addon.startCapture(
      pid,
      (chunk) => {
        const share = current;
        if (share?.id !== id || !share.attached) return;
        if (!sender.isDestroyed()) sender.send(IPC.appAudioChunk, id, chunk);
      },
      (message) => {
        // ended by itself, e.g. the app was closed: tell the page once
        gameLog(`App audio of process ${pid} ended: ${message}`);
        if (current?.id === id && !sender.isDestroyed())
          sender.send(IPC.appAudioEnded, id, message);
        if (current?.id === id) stopAppShare();
      },
    );
    const end = () => {
      if (current?.id === id) stopAppShare();
    };
    // the page going away or navigating away ends the share
    sender.on("did-navigate", end);
    sender.on("render-process-gone", end);
    sender.once("destroyed", end);
    current = {
      id,
      sender,
      capture,
      attached: false,
      timer: setTimeout(end, ATTACH_TIMEOUT_MS),
      unlisten: () => {
        if (sender.isDestroyed()) return;
        sender.removeListener("did-navigate", end);
        sender.removeListener("render-process-gone", end);
        sender.removeListener("destroyed", end);
      },
    };
    gameLog(`App audio capture ${id} started for process ${pid}`);
    return true;
  } catch (error) {
    gameLog(`App audio capture for process ${pid} failed: ${String(error)}`);
    return false;
  }
}

/**
 * Let the page ask for the capture started for its share, and end it.
 *
 * @param isTrusted Whether an IPC message comes from the app page
 */
export function installAppAudio(
  isTrusted: (event: Electron.IpcMainInvokeEvent) => boolean,
) {
  // The page is ready to play the sound: chunks flow from now on
  ipcMain.handle(IPC.appAudioAttach, (event) => {
    if (!isTrusted(event)) return null;
    const share = current;
    if (!share || share.sender !== event.sender) return null;
    share.attached = true;
    clearTimeout(share.timer);
    return share.id;
  });
  // The page's audio track ended, the id keeps a late call from stopping a
  // newer capture
  ipcMain.handle(IPC.appAudioStop, (event, id: unknown) => {
    if (!isTrusted(event)) return;
    const share = current;
    if (share && share.id === id && share.sender === event.sender)
      stopAppShare();
  });
}
