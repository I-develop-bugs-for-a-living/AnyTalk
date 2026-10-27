import type {
  CallBytesEntry,
  CallConnectionEntry,
  HttpEntry,
  ResourceEntry,
  TrafficEntry,
  WsEntry,
} from "./types";

/** How far apart (ms) an http entry and its resource entry may start. */
export const MERGE_WINDOW_MS = 100;

/** `initiatorType`s of resource entries that duplicate fetch/XHR entries. */
const DUPLICATE_INITIATORS = new Set(["fetch", "xmlhttprequest"]);

/**
 * Absolute form of a URL, to compare addresses written differently. Returns
 * the input when it cannot be parsed.
 *
 * @param url Absolute or relative URL
 * @param base Base for relative URLs
 */
export function absoluteUrl(
  url: string,
  base: string | undefined = globalThis.location?.href,
): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** Merged copies by http entry and resource entry, so they keep their identity. */
const mergedCache = new WeakMap<HttpEntry, WeakMap<ResourceEntry, HttpEntry>>();

/**
 * Fold the browser's `resource` entries for fetch and XMLHttpRequest into the
 * `http` entries the wrappers recorded for the same request: protocol, sizes
 * and duration are copied over and the resource entry is dropped. A resource
 * matches the nearest unmatched http entry with the same absolute URL that
 * started within 100 ms. Other resources (images, video, ...) stay as they
 * are. The input is not changed.
 *
 * @param entries Entries, oldest first
 * @param base Base for relative URLs (defaults to the page address)
 */
export function mergeResources(
  entries: TrafficEntry[],
  base?: string,
): TrafficEntry[] {
  const resources = entries.filter(
    (e): e is ResourceEntry =>
      e.kind === "resource" && DUPLICATE_INITIATORS.has(e.initiatorType),
  );
  if (!resources.length) return entries;

  // http entries by absolute URL
  const byUrl = new Map<string, HttpEntry[]>();
  for (const e of entries) {
    if (e.kind !== "http") continue;
    const key = absoluteUrl(e.url, base);
    const list = byUrl.get(key);
    if (list) list.push(e);
    else byUrl.set(key, [e]);
  }

  const taken = new Set<HttpEntry>();
  /** Merged fields by http entry */
  const merged = new Map<HttpEntry, ResourceEntry>();
  const dropped = new Set<ResourceEntry>();
  for (const resource of resources) {
    let best: HttpEntry | undefined;
    let bestGap = Infinity;
    for (const http of byUrl.get(absoluteUrl(resource.url, base)) ?? []) {
      if (taken.has(http)) continue;
      const gap = Math.abs(http.start - resource.start);
      if (gap <= MERGE_WINDOW_MS && gap < bestGap) {
        best = http;
        bestGap = gap;
      }
    }
    if (!best) continue;
    taken.add(best);
    merged.set(best, resource);
    dropped.add(resource);
  }

  return entries
    .filter((e) => !(e.kind === "resource" && dropped.has(e)))
    .map((e): TrafficEntry => {
      const resource = e.kind === "http" ? merged.get(e) : undefined;
      if (e.kind === "http" && resource) {
        const known = mergedCache.get(e)?.get(resource);
        if (known) return known;
        const made: HttpEntry = {
          ...e,
          protocol: resource.protocol || undefined,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
          decodedBodySize: resource.decodedBodySize,
          durationMs: resource.durationMs,
        };
        let byResource = mergedCache.get(e);
        if (!byResource) mergedCache.set(e, (byResource = new WeakMap()));
        byResource.set(resource, made);
        return made;
      }
      return e;
    });
}

/** The groups of the kind filter. */
export type KindGroup = "http" | "ws" | "call" | "files";

/**
 * Which kind filter group an entry belongs to.
 *
 * @param entry Any entry
 */
export function kindGroup(entry: TrafficEntry): KindGroup {
  switch (entry.kind) {
    case "http":
      return "http";
    case "ws":
      return "ws";
    case "resource":
      return "files";
    default:
      return "call";
  }
}

/** Matches the path of LiveKit's signalling socket (`/rtc`, `/rtc/v1`). */
const SIGNAL_PATH = /\/rtc(\/v\d+)?\/?$/;

/**
 * Whether a WebSocket entry is a frame of LiveKit's signalling socket.
 *
 * @param entry A WebSocket entry
 */
function isSignalFrame(entry: WsEntry): boolean {
  if (entry.event !== "frame") return false;
  try {
    return SIGNAL_PATH.test(new URL(entry.url).pathname);
  } catch {
    return false;
  }
}

/**
 * Drop the call entries that bury everything else: frames of the LiveKit
 * signalling socket (pings, quality updates, ICE) and byte count snapshots
 * that only changed the numbers. A byte snapshot stays when the set of media
 * streams changed since the one before on the same peer connection. Opening,
 * closing and errors of the socket stay.
 *
 * @param entries Entries, oldest first
 */
export function hideCallNoise(entries: TrafficEntry[]): TrafficEntry[] {
  const lastTracks = new Map<CallBytesEntry["pc"], string>();
  return entries.filter((e) => {
    if (e.kind === "ws") return !isSignalFrame(e);
    if (e.kind !== "call-bytes") return true;
    const key = e.tracks
      .map((t) => `${t.direction}|${t.kind}|${t.id}`)
      .sort()
      .join(",");
    const changed = lastTracks.get(e.pc) !== key;
    lastTracks.set(e.pc, key);
    return changed;
  });
}

/** Where the entry's destination is, for filtering and display. */
export function entryHost(entry: TrafficEntry): string {
  switch (entry.kind) {
    case "http":
    case "ws":
    case "resource":
    case "call-info":
      return entry.host;
    case "call-connection":
      return remoteOf(entry);
    default:
      return "";
  }
}

/**
 * Address and port of a call connection's remote side ("1.2.3.4:7881",
 * "[::1]:7881"). Empty when unknown.
 *
 * @param entry A call connection entry
 */
export function remoteOf(entry: CallConnectionEntry): string {
  if (!entry.remoteAddress) return "";
  const address = entry.remoteAddress.includes(":")
    ? `[${entry.remoteAddress}]`
    : entry.remoteAddress;
  return entry.remotePort === undefined
    ? address
    : `${address}:${entry.remotePort}`;
}

/**
 * Keep the entries that match a kind group and a text. The text is matched
 * (case-insensitive) against the URL, host and topic.
 *
 * @param entries Entries to filter
 * @param options.group Kind group, or all when missing
 * @param options.text Text to look for
 */
export function filterEntries(
  entries: TrafficEntry[],
  options: { group?: KindGroup; text?: string },
): TrafficEntry[] {
  const text = options.text?.trim().toLowerCase();
  return entries.filter((e) => {
    if (options.group && kindGroup(e) !== options.group) return false;
    if (!text) return true;
    const haystack = [
      "url" in e ? e.url : "",
      entryHost(e),
      e.kind === "call-data" ? e.topic : "",
      e.kind === "call-info" ? e.room : "",
    ];
    return haystack.some((s) => s.toLowerCase().includes(text));
  });
}

/** What a row of the destinations summary is. */
export type DestinationType =
  | "https"
  | "http"
  | "wss"
  | "ws"
  | "call"
  | "files";

/** One row of the destinations summary. */
export type Destination = {
  host: string;
  type: DestinationType;
  count: number;
  /** Total bytes where known. */
  bytes?: number;
};

/** Bytes of a request body. */
function requestBytes(entry: HttpEntry): number {
  const body = entry.requestBody;
  return body.kind === "text" || body.kind === "binary" ? body.size : 0;
}

/**
 * Group entries by where they went: host plus kind (HTTPS, WSS, call, files)
 * with a count and the bytes where known. Call media is listed under the
 * remote address and port of the selected network path, its bytes are the
 * last totals of each peer connection. Largest groups first.
 *
 * @param entries Entries, with resources merged
 */
export function summarizeDestinations(entries: TrafficEntry[]): Destination[] {
  const rows = new Map<string, Destination>();
  const add = (
    host: string,
    type: DestinationType,
    bytes: number | undefined,
    count = 1,
  ) => {
    if (!host) return;
    const key = `${type}|${host}`;
    const row = rows.get(key) ?? { host, type, count: 0 };
    row.count += count;
    if (bytes !== undefined) row.bytes = (row.bytes ?? 0) + bytes;
    rows.set(key, row);
  };

  /** Latest remote of each peer connection, and its latest byte total */
  const remotes = new Map<string, string>();
  const totals = new Map<string, number>();
  /** Websockets counted once (by connection), frames add bytes only */
  const sockets = new Set<number>();

  for (const e of entries) {
    switch (e.kind) {
      case "http": {
        const known = e.transferSize || e.responseSize;
        const bytes =
          known !== undefined || requestBytes(e)
            ? (known ?? 0) + requestBytes(e)
            : undefined;
        add(e.host, e.url.startsWith("https:") ? "https" : "http", bytes);
        break;
      }
      case "ws": {
        const type = e.url.startsWith("wss:") ? "wss" : "ws";
        const first = !sockets.has(e.connectionId);
        sockets.add(e.connectionId);
        // the host is counted once per socket, not once per frame
        if (e.event === "frame") {
          add(e.host, type, e.size ?? 0, first ? 1 : 0);
        } else if (first) {
          add(e.host, type, undefined);
        }
        break;
      }
      case "resource":
        add(
          e.host,
          "files",
          e.transferSize > 0 ? e.transferSize : e.encodedBodySize,
        );
        break;
      case "call-info":
        add(e.host, "call", undefined);
        break;
      case "call-connection": {
        const remote = remoteOf(e);
        if (remote) {
          if (remotes.get(e.pc) !== remote) add(remote, "call", undefined);
          remotes.set(e.pc, remote);
        }
        break;
      }
      case "call-bytes":
        totals.set(e.pc, (e.bytesSent ?? 0) + (e.bytesReceived ?? 0));
        break;
      default:
        break;
    }
  }

  // the totals are cumulative, so only the last snapshot of a connection counts
  for (const [pc, bytes] of totals) {
    const remote = remotes.get(pc);
    if (remote) add(remote, "call", bytes, 0);
  }

  return [...rows.values()].sort(
    (a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || b.count - a.count,
  );
}

/**
 * Size of an entry in bytes where known, for the list.
 *
 * @param entry Any entry
 */
export function entrySize(entry: TrafficEntry): number | undefined {
  switch (entry.kind) {
    case "http":
      return entry.transferSize || entry.responseSize;
    case "ws":
    case "call-data":
      return entry.size;
    case "resource":
      return entry.transferSize > 0
        ? entry.transferSize
        : entry.encodedBodySize;
    default:
      return undefined;
  }
}

/**
 * Time an entry happened (start for requests), epoch milliseconds.
 *
 * @param entry Any entry
 */
export function entryTime(entry: TrafficEntry): number {
  return entry.kind === "http" || entry.kind === "resource"
    ? entry.start
    : entry.time;
}

/**
 * Duration of an entry in ms where known.
 *
 * @param entry Any entry
 */
export function entryDuration(entry: TrafficEntry): number | undefined {
  if (entry.kind === "http") return entry.durationMs ?? entry.end - entry.start;
  if (entry.kind === "resource") return entry.durationMs;
  return undefined;
}

/**
 * The cutoff for a paused list: the highest entry id so far (0 when empty).
 *
 * @param entries Entries as shown
 */
export function pauseCutoff(entries: TrafficEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, e.id), 0);
}

/**
 * The entries recorded up to a cutoff, or all of them when there is none.
 *
 * @param entries Entries, oldest first
 * @param cutoff Highest id to keep, from `pauseCutoff`
 */
export function upToId(
  entries: TrafficEntry[],
  cutoff: number | undefined,
): TrafficEntry[] {
  return cutoff === undefined ? entries : entries.filter((e) => e.id <= cutoff);
}
