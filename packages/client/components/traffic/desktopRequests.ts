import type { TrafficRecorder } from "./recorder";
import type { HeaderList, HttpEntry, NewEntry } from "./types";

/**
 * A request the desktop app's session saw, as the shell sends it (see
 * `DesktopRequest` in `packages/desktop/src/shared/ipc.ts`, kept in sync by
 * hand). Header values are raw: they are redacted when entries are read.
 */
export type DesktopRequestEvent = {
  id: number;
  method: string;
  url: string;
  resourceType: string;
  start: number;
  end: number;
  background: boolean;
  requestHeaders: [string, string][];
  status?: number;
  statusLine?: string;
  responseHeaders: [string, string][];
  fromCache: boolean;
  error?: string;
  ip?: string;
};

/** Resource types that count as requests, the rest are shown as files. */
const REQUEST_TYPES = new Set([
  "xhr",
  "ping",
  "cspReport",
  "webSocket",
  "mainFrame",
  "subFrame",
]);

/**
 * Whether a desktop entry is a file the browser loaded (image, media, script,
 * font, ...) rather than a request.
 *
 * @param entry An http entry
 */
export function isDesktopFile(entry: HttpEntry): boolean {
  return (
    entry.source === "desktop" &&
    !REQUEST_TYPES.has(entry.resourceType ?? "xhr")
  );
}

/** Host of a URL, empty when it cannot be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Value of the first header with this name (case-insensitive). */
function headerValue(headers: HeaderList, name: string): string | undefined {
  return headers.find(([n]) => n.toLowerCase() === name)?.[1];
}

/**
 * Turn a request the desktop session saw into an http entry.
 *
 * @param event The event from the shell
 */
export function desktopRequestToEntry(
  event: DesktopRequestEvent,
): NewEntry<HttpEntry> {
  const length = Number(headerValue(event.responseHeaders, "content-length"));
  return {
    kind: "http",
    source: "desktop",
    method: event.method,
    url: event.url,
    host: hostOf(event.url),
    start: event.start,
    end: event.end,
    status: event.status,
    // "HTTP/1.1 200 OK" -> "OK"
    statusText: event.statusLine?.split(" ").slice(2).join(" ") || undefined,
    error: event.error,
    requestHeaders: event.requestHeaders,
    responseHeaders: event.responseHeaders,
    requestBody: { kind: "none" },
    responseSize: Number.isFinite(length) && length >= 0 ? length : undefined,
    resourceType: event.resourceType,
    background: event.background,
    fromCache: event.fromCache,
    remoteAddress: event.ip,
  };
}

/**
 * Record the requests the desktop session sees while recording is on. Does
 * nothing outside the desktop app or in older desktop versions. The shell
 * only collects while this is active.
 *
 * @param recorder Where to record
 * @returns A function that stops watching
 */
export function observeDesktopRequests(recorder: TrafficRecorder): () => void {
  const native = globalThis.window?.native;
  if (!native?.setRequestWatch || !native.onDesktopRequests) return () => {};
  const stopListening = native.onDesktopRequests((batch) => {
    if (!recorder.enabled) return;
    for (const event of batch) {
      try {
        recorder.record(desktopRequestToEntry(event));
      } catch {
        // one odd event must not drop the rest
      }
    }
  });
  native.setRequestWatch(true).catch(() => {});
  return () => {
    stopListening();
    native.setRequestWatch?.(false).catch(() => {});
  };
}
