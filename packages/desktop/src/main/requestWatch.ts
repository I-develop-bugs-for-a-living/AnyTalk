import { type WebContents, session } from "electron";

import type { DesktopRequest } from "../shared/ipc";
import {
  type EndDetails,
  type Pending,
  shouldReport,
  toDesktopRequest,
} from "./requestWatchLogic";
import { serverOrigin } from "./url";

/** Most requests waiting for their end, so a stuck one can't grow memory. */
const MAX_PENDING = 1000;

/** Most events kept for one flush, the oldest are dropped beyond this. */
const MAX_QUEUE = 500;

/** How long events are collected before they go to the page (ms). */
const BATCH_MS = 200;

let queue: DesktopRequest[] = [];
let timer: NodeJS.Timeout | undefined;
const pending = new Map<number, Pending>();
let watching = false;

/**
 * Start or stop reporting requests. Only observes: the listeners never block
 * or change a request. While off no listener exists, so nothing is collected.
 *
 * Electron allows one listener per `webRequest` event. This module owns that
 * slot for `onSendHeaders`, `onCompleted` and `onErrorOccurred` on the default
 * session: nothing else may register a listener for them, or one of the two
 * silently replaces the other.
 *
 * @param on Whether the page is recording
 * @param getPage The page that has the page recorder
 * @param send Delivers a batch of events to that page
 */
export function setRequestWatch(
  on: boolean,
  getPage: () => WebContents | undefined,
  send: (batch: DesktopRequest[]) => void,
) {
  if (on === watching) return;
  watching = on;
  const webRequest = session.defaultSession.webRequest;
  if (!on) {
    // null removes the listener
    webRequest.onSendHeaders(null);
    webRequest.onCompleted(null);
    webRequest.onErrorOccurred(null);
    pending.clear();
    queue = [];
    clearTimeout(timer);
    timer = undefined;
    return;
  }

  /** Report a finished request unless the page recorder has it. */
  const finish = (details: EndDetails) => {
    const known = pending.get(details.id);
    pending.delete(details.id);
    if (!shouldReport(details, getPage()?.id, serverOrigin())) return;
    queue.push(toDesktopRequest(details, known));
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    timer ??= setTimeout(() => {
      timer = undefined;
      const batch = queue;
      queue = [];
      if (batch.length) send(batch);
    }, BATCH_MS);
  };

  // onSendHeaders is the observe-only variant of onBeforeSendHeaders: it has
  // no callback, so it cannot hold back or change the request
  webRequest.onSendHeaders((details) => {
    if (!shouldReport(details, getPage()?.id, serverOrigin())) return;
    if (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next().value;
      if (oldest !== undefined) pending.delete(oldest);
    }
    pending.set(details.id, {
      start: details.timestamp,
      requestHeaders: Object.entries(details.requestHeaders),
    });
  });
  webRequest.onCompleted((details) => finish(details));
  webRequest.onErrorOccurred((details) => finish(details));
}
