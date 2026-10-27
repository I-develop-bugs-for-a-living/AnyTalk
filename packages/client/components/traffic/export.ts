import { findHeader } from "./summarize";
import type { HeaderList, HttpEntry, TrafficEntry, WsEntry } from "./types";

/** Version of the export format, written into the creator field. */
const VERSION = "1";

/** A name and value pair as HAR writes headers and query parameters. */
type HarPair = { name: string; value: string };

/** HAR protocol name for the browser's `nextHopProtocol`. */
function harVersion(protocol: string | undefined): string {
  switch (protocol) {
    case "h2":
      return "HTTP/2.0";
    case "h3":
      return "HTTP/3.0";
    case "http/1.1":
      return "HTTP/1.1";
    case "http/1.0":
      return "HTTP/1.0";
    default:
      return protocol || "unknown";
  }
}

/** Header list as HAR pairs. */
function harHeaders(headers: HeaderList): HarPair[] {
  return headers.map(([name, value]) => ({ name, value }));
}

/** Query parameters of a URL as HAR pairs. */
function harQuery(url: string): HarPair[] {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({
      name,
      value,
    }));
  } catch {
    return [];
  }
}

/** One HAR entry for a fetch or XMLHttpRequest. */
function harHttp(e: HttpEntry) {
  const time = Math.max(0, e.durationMs ?? e.end - e.start);
  const mimeType = findHeader(e.responseHeaders, "content-type") ?? "";
  const body = e.requestBody;
  const requestMime = findHeader(e.requestHeaders, "content-type") ?? "";
  return {
    startedDateTime: new Date(e.start).toISOString(),
    time,
    request: {
      method: e.method,
      url: e.url,
      httpVersion: harVersion(e.protocol),
      cookies: [],
      headers: harHeaders(e.requestHeaders),
      queryString: harQuery(e.url),
      ...(body.kind === "text"
        ? { postData: { mimeType: requestMime, text: body.text } }
        : {}),
      headersSize: -1,
      bodySize: body.kind === "text" || body.kind === "binary" ? body.size : -1,
    },
    response: {
      status: e.status ?? 0,
      statusText: e.statusText ?? "",
      httpVersion: harVersion(e.protocol),
      cookies: [],
      headers: harHeaders(e.responseHeaders),
      content: {
        size: e.decodedBodySize ?? e.responseSize ?? -1,
        mimeType,
        ...(e.responsePreview === undefined ? {} : { text: e.responsePreview }),
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: e.encodedBodySize ?? e.responseSize ?? -1,
      ...(e.transferSize === undefined
        ? {}
        : { _transferSize: e.transferSize }),
      ...(e.error ? { _error: e.error } : {}),
    },
    cache: {},
    timings: { send: 0, wait: time, receive: 0 },
    _source: e.source,
    ...(e.resourceType ? { _resourceType: e.resourceType } : {}),
  };
}

/** One HAR entry per WebSocket connection, frames as Chrome writes them. */
function harSockets(entries: WsEntry[]) {
  const byConnection = new Map<number, WsEntry[]>();
  for (const e of entries) {
    const list = byConnection.get(e.connectionId);
    if (list) list.push(e);
    else byConnection.set(e.connectionId, [e]);
  }

  return [...byConnection.values()].map((events) => {
    const first = events[0];
    const last = events[events.length - 1];
    const closed = events.find((e) => e.event === "close");
    const time = Math.max(0, last.time - first.time);
    return {
      startedDateTime: new Date(first.time).toISOString(),
      time,
      request: {
        method: "GET",
        url: first.url,
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        queryString: harQuery(first.url),
        headersSize: -1,
        bodySize: 0,
      },
      response: {
        status: 101,
        statusText: "Switching Protocols",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        content: { size: 0, mimeType: "" },
        redirectURL: "",
        headersSize: -1,
        bodySize: 0,
        ...(closed
          ? { _closeCode: closed.code, _closeReason: closed.reason }
          : {}),
      },
      cache: {},
      timings: { send: 0, wait: time, receive: 0 },
      _resourceType: "websocket",
      _webSocketMessages: events
        .filter((e) => e.event === "frame")
        .map((e) => ({
          type: e.direction === "out" ? "send" : "receive",
          // seconds since the epoch, as Chrome writes them
          time: e.time / 1000,
          opcode: e.text === undefined ? 2 : 1,
          data: e.text ?? e.hex ?? "",
        })),
    };
  });
}

/**
 * Build a HAR 1.2 document from fetch/XMLHttpRequest entries (with the
 * browser's timing merged in, see `mergeResources`) and WebSocket entries.
 * Other entries are left out; use `buildJson` for everything.
 *
 * @param entries Entries as returned by `entries()`, so already redacted
 *  unless the user asked for secrets
 */
export function buildHar(entries: TrafficEntry[]) {
  const http = entries.filter((e): e is HttpEntry => e.kind === "http");
  const ws = entries.filter((e): e is WsEntry => e.kind === "ws");
  const rows = [...http.map(harHttp), ...harSockets(ws)].sort((a, b) =>
    a.startedDateTime.localeCompare(b.startedDateTime),
  );
  return {
    log: {
      version: "1.2",
      creator: { name: "AnyTalk network inspector", version: VERSION },
      pages: [],
      entries: rows,
    },
  };
}

/**
 * The plain JSON export: every entry as recorded (redacted as passed in).
 *
 * @param entries Entries as returned by `entries()`
 */
export function buildJson(entries: TrafficEntry[]) {
  return {
    exportedAt: new Date().toISOString(),
    creator: { name: "AnyTalk network inspector", version: VERSION },
    entries,
  };
}
