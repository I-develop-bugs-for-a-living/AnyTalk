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

/** Anything the recorder stores. */
export type TrafficEntry = HttpEntry | WsEntry | ResourceEntry;

/** An entry before the recorder gives it an id. */
export type NewEntry<T extends TrafficEntry = TrafficEntry> = T extends unknown
  ? Omit<T, "id">
  : never;
