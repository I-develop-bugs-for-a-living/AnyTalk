import type { DesktopRequest } from "../shared/ipc";

/** Pieces of Electron's request details that this module reads. */
export type RequestDetails = {
  id: number;
  url: string;
  method: string;
  resourceType: string;
  timestamp: number;
  webContentsId?: number;
};

/** What `onSendHeaders` saw, kept until the request ends. */
export type Pending = {
  start: number;
  requestHeaders: [string, string][];
};

/** Electron's `onCompleted` and `onErrorOccurred` details, in short. */
export type EndDetails = RequestDetails & {
  statusCode?: number;
  statusLine?: string;
  responseHeaders?: Record<string, string[]>;
  fromCache?: boolean;
  error?: string;
  ip?: string;
};

/** Resource types a page makes through fetch, XMLHttpRequest or WebSocket. */
const PAGE_RECORDED_TYPES = new Set(["xhr", "webSocket"]);

/** Origin of a URL, undefined when it cannot be parsed. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Whether a request is one the desktop session should report.
 *
 * Dedupe rule: the page's own recorder (`@revolt/traffic`) wraps `fetch`,
 * `XMLHttpRequest` and `WebSocket` of the main window's page. Chromium
 * reports all three to the network layer as `xhr` (fetch and XHR) or
 * `webSocket`, so those are skipped when they come from that page, and
 * everything else is reported: images, media, scripts, styles, fonts, frames,
 * pings, and any request without a page (main process, updater). Only
 * http(s) and ws(s) are reported.
 *
 * Service workers: a page's fetch that the service worker forwards shows up
 * a second time without a page. Such `xhr` requests to the app's own server
 * origin are treated as covered by the page recorder and skipped too.
 *
 * @param details The request
 * @param pageId `webContents.id` of the page that has the page recorder
 * @param appOrigin Origin of the app's own server
 */
export function shouldReport(
  details: Pick<RequestDetails, "url" | "resourceType" | "webContentsId">,
  pageId: number | undefined,
  appOrigin?: string,
): boolean {
  if (!/^(https?|wss?):/i.test(details.url)) return false;
  if (
    details.resourceType === "xhr" &&
    details.webContentsId === undefined &&
    appOrigin !== undefined &&
    originOf(details.url) === appOrigin
  )
    return false;
  return !(
    PAGE_RECORDED_TYPES.has(details.resourceType) &&
    pageId !== undefined &&
    details.webContentsId === pageId
  );
}

/**
 * Flatten Electron's response headers (a list of values per name) into one
 * entry per value.
 *
 * @param headers Headers as Electron gives them
 */
export function flattenResponseHeaders(
  headers: Record<string, string[] | string> | undefined,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) for (const v of value) out.push([name, v]);
    else out.push([name, String(value)]);
  }
  return out;
}

/**
 * Build the event sent to the page from the details of a finished request.
 *
 * @param details Details from `onCompleted` or `onErrorOccurred`
 * @param pending What `onSendHeaders` saw, missing for cached responses
 */
export function toDesktopRequest(
  details: EndDetails,
  pending: Pending | undefined,
): DesktopRequest {
  return {
    id: details.id,
    method: details.method,
    url: details.url,
    resourceType: details.resourceType,
    start: pending?.start ?? details.timestamp,
    end: details.timestamp,
    background: details.webContentsId === undefined,
    requestHeaders: pending?.requestHeaders ?? [],
    status: details.statusCode || undefined,
    statusLine: details.statusLine || undefined,
    responseHeaders: flattenResponseHeaders(details.responseHeaders),
    fromCache: !!details.fromCache,
    error: details.error,
    ip: details.ip,
  };
}
