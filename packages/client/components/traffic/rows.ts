import { formatBytes } from "./format";
import type { TrafficEntry } from "./types";
import { remoteOf } from "./view";

/** Badge shown for the kind of an entry. */
export type RowBadge = "HTTP" | "WS" | "CALL" | "FILE";

/** Events that have no method or direction, the UI translates their names. */
export type RowEvent =
  | "connect"
  | "attached"
  | "open"
  | "close"
  | "error"
  | "joined"
  | "route"
  | "bytes"
  | "attributes";

/** How a call connection's media travels, the UI translates it. */
export type RowRoute = "relay" | "direct";

/** What the list shows for one entry, before it is translated. */
export type RowSummary = {
  badge: RowBadge;
  /** Request method, for http and files. */
  method?: string;
  /** Direction of a frame or data message. */
  dir?: "in" | "out";
  /** Event name, when there is no method or direction. */
  event?: RowEvent;
  /** Status code, "ERR" for failed requests, or empty. */
  status: string;
  /** Whether media goes through a relay or direct, for call connections. */
  route?: RowRoute;
  /** Short path, topic or preview. */
  summary: string;
  host: string;
};

/** Path and query of a URL, the whole input when it cannot be parsed. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** First characters of a text, with line breaks flattened. */
function shorten(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? flat.slice(0, limit) + "…" : flat;
}

/**
 * Describe an entry for a row of the list: what to show in each column.
 *
 * @param entry Any entry
 */
export function describeRow(entry: TrafficEntry): RowSummary {
  switch (entry.kind) {
    case "http":
      return {
        badge: "HTTP",
        method: entry.method,
        status: entry.error ? "ERR" : entry.status ? String(entry.status) : "",
        summary: pathOf(entry.url),
        host: entry.host,
      };
    case "resource":
      return {
        badge: "FILE",
        method: "GET",
        status: entry.status ? String(entry.status) : "",
        summary: pathOf(entry.url),
        host: entry.host,
      };
    case "ws": {
      const base = { badge: "WS" as const, host: entry.host };
      if (entry.event === "frame") {
        return {
          ...base,
          dir: entry.direction,
          status: "",
          summary: shorten(entry.text ?? entry.hex ?? ""),
        };
      }
      return {
        ...base,
        event: entry.event,
        status: entry.code === undefined ? "" : String(entry.code),
        summary: pathOf(entry.url),
      };
    }
    case "call-info":
      return {
        badge: "CALL",
        event: "joined",
        status: "",
        summary: entry.room,
        host: entry.host,
      };
    case "call-connection":
      return {
        badge: "CALL",
        event: "route",
        status: entry.dtlsState ?? "",
        route: entry.relayed ? "relay" : "direct",
        summary: `${entry.pc}${entry.protocol ? ` ${entry.protocol}` : ""}`,
        host: remoteOf(entry),
      };
    case "call-bytes":
      return {
        badge: "CALL",
        event: "bytes",
        status: "",
        summary: `${entry.pc} · ↑ ${formatBytes(entry.bytesSent) || "?"} ↓ ${
          formatBytes(entry.bytesReceived) || "?"
        }`,
        host: "",
      };
    case "call-data":
      return {
        badge: "CALL",
        dir: entry.direction,
        status: "",
        summary: entry.topic || shorten(entry.preview),
        host: "",
      };
    case "call-attribute":
      return {
        badge: "CALL",
        dir: "out",
        event: "attributes",
        status: "",
        summary: entry.attributes.map((a) => a.key).join(", "),
        host: "",
      };
  }
}
