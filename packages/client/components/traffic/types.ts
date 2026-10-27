/**
 * Summary of a request body. Never holds more than a short preview, and form
 * fields only keep their names (not their values).
 */
export type BodySummary =
  | { kind: "none" }
  | { kind: "text"; size: number; text: string; truncated: boolean }
  | { kind: "form"; fields: FormFieldSummary[] }
  | { kind: "binary"; size: number; type?: string }
  | { kind: "stream" }
  | { kind: "other"; description: string };

/**
 * One field of a FormData body: its name and, for files, name, size and type.
 */
export type FormFieldSummary = {
  name: string;
  file?: { name: string; size: number; type: string };
};

/** Header list in the order seen; names keep their original case. */
export type HeaderList = [name: string, value: string][];

/**
 * A finished (or failed) fetch or XMLHttpRequest. Recorded when the response
 * headers arrived (fetch) or the request ended (xhr).
 */
export type HttpEntry = {
  kind: "http";
  id: number;
  source: "fetch" | "xhr";
  method: string;
  url: string;
  host: string;
  /** Epoch milliseconds when the request started. */
  start: number;
  /** Epoch milliseconds when the response headers arrived or it failed. */
  end: number;
  status?: number;
  statusText?: string;
  /** Set when the request failed before a response (network error, abort). */
  error?: string;
  requestHeaders: HeaderList;
  responseHeaders: HeaderList;
  requestBody: BodySummary;
  /** Response size in bytes when known (content-length or loaded body). */
  responseSize?: number;
  /** Text of small text/JSON responses. */
  responsePreview?: string;
  /**
   * Browser timing, merged in from the matching `resource` entry (see
   * `mergeResources`). Only set on entries returned by `entries()`.
   */
  protocol?: string;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  durationMs?: number;
};

/**
 * A WebSocket event: the connection opening or closing, an error, or a frame.
 * Frames link to their connection with `connectionId`.
 */
export type WsEntry = {
  kind: "ws";
  id: number;
  connectionId: number;
  /** `attached` marks a connection that was already open when recording began. */
  event: "connect" | "attached" | "open" | "close" | "error" | "frame";
  url: string;
  host: string;
  time: number;
  /** Close code and reason, for `close`. */
  code?: number;
  reason?: string;
  wasClean?: boolean;
  /** Frame direction, for `frame`. */
  direction?: "in" | "out";
  /** Frame size in bytes (characters' UTF-8 length for text). */
  size?: number;
  /** Text frames: the text, cut at the preview limit. */
  text?: string;
  /** Binary frames: hex of the first bytes. */
  hex?: string;
  truncated?: boolean;
};

/**
 * A resource loaded by the browser itself (images, video, iframes, ...),
 * seen only through PerformanceObserver.
 */
export type ResourceEntry = {
  kind: "resource";
  id: number;
  url: string;
  host: string;
  initiatorType: string;
  /** Epoch milliseconds when the load started. */
  start: number;
  durationMs: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  protocol: string;
  status?: number;
};

/**
 * One call (LiveKit) at the time it was joined, or when recording was turned
 * on during it. Says where the media goes and whether it is end-to-end
 * encrypted.
 */
export type CallInfoEntry = {
  kind: "call-info";
  id: number;
  time: number;
  /** LiveKit room name. */
  room: string;
  /** SFU address as given by the API (tokens are redacted when read). */
  url: string;
  host: string;
  /** Whether the call's media is end-to-end encrypted. */
  e2ee: boolean;
};

/**
 * The peer connections LiveKit keeps: a publisher and a subscriber, or just
 * one `connection` in single peer connection mode.
 */
export type CallPeerConnection = "publisher" | "subscriber" | "connection";

/**
 * The network path a call peer connection selected: where media goes and how
 * it is protected on the wire. A new entry is recorded when the path changes.
 */
export type CallConnectionEntry = {
  kind: "call-connection";
  id: number;
  time: number;
  pc: CallPeerConnection;
  /** Local and remote candidate types: host, srflx, prflx or relay. */
  localType?: string;
  remoteType?: string;
  /** Transport of the selected pair: udp or tcp. */
  protocol?: string;
  /** True when the media goes through a TURN relay. */
  relayed: boolean;
  /** Protocol spoken to the TURN server (udp, tcp, tls), relayed only. */
  relayProtocol?: string;
  /** STUN/TURN server the local candidate came from, if exposed. */
  relayUrl?: string;
  remoteAddress?: string;
  remotePort?: number;
  /** Network type of the local interface (wifi, cellular, ...). */
  networkType?: string;
  dtlsState?: string;
  dtlsCipher?: string;
  srtpCipher?: string;
  tlsVersion?: string;
};

/** Bytes moved by one media stream in a stats snapshot. */
export type CallTrackBytes = {
  direction: "out" | "in";
  kind: string;
  /** Media id (mid) or track identifier. */
  id: string;
  bytes: number;
  packets: number;
};

/**
 * A snapshot of cumulative byte counts of a call peer connection. Only
 * recorded when the counts changed since the last snapshot.
 */
export type CallBytesEntry = {
  kind: "call-bytes";
  id: number;
  time: number;
  pc: CallPeerConnection;
  /** Totals of the whole transport. */
  bytesSent?: number;
  bytesReceived?: number;
  tracks: CallTrackBytes[];
};

/**
 * A LiveKit data message we sent or received. The payload preview is raw; key
 * exchange messages are redacted when read.
 */
export type CallDataEntry = {
  kind: "call-data";
  id: number;
  time: number;
  direction: "in" | "out";
  topic: string;
  /**
   * `all`, or the identities addressed. Outgoing only: for received messages
   * it isn't known.
   */
  destination?: "all" | string[];
  /** Sender identity (incoming). */
  identity?: string;
  reliable?: boolean;
  size: number;
  preview: string;
  truncated: boolean;
};

/**
 * Participant attributes we set on the call (hello, deafened, follow).
 */
export type CallAttributeEntry = {
  kind: "call-attribute";
  id: number;
  time: number;
  attributes: { key: string; value: string }[];
};

/** Entries about a call. */
export type CallEntry =
  | CallInfoEntry
  | CallConnectionEntry
  | CallBytesEntry
  | CallDataEntry
  | CallAttributeEntry;

/** Anything the recorder stores. */
export type TrafficEntry = HttpEntry | WsEntry | ResourceEntry | CallEntry;

/** An entry before the recorder gives it an id. */
export type NewEntry<T extends TrafficEntry = TrafficEntry> = T extends unknown
  ? Omit<T, "id">
  : never;
