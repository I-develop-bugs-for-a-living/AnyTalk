import type { TrafficRecorder } from "./recorder";
import {
  RESPONSE_PREVIEW_MAX_BYTES,
  findHeader,
  hostOf,
  isTextContentType,
  parseRawHeaders,
  summarizeBody,
  truncateText,
} from "./summarize";
import type { BodySummary, HeaderList } from "./types";

/** Request details collected between `open` and `send`. */
type XhrState = {
  method: string;
  url: string;
  headers: HeaderList;
  body?: BodySummary;
};

/**
 * Patch the prototype of `XMLHttpRequest` so requests are recorded when they
 * end (`loadend`). Calls always go to the original first; recording only reads
 * state afterwards. Requests opened while recording is off are not recorded.
 *
 * @param xhr The `XMLHttpRequest` class to patch
 * @param recorder Where entries go
 * @param now Clock, replaceable in tests
 */
export function wrapXhr(
  xhr: typeof XMLHttpRequest,
  recorder: TrafficRecorder,
  now: () => number = Date.now,
) {
  const proto = xhr.prototype;
  const originalOpen = proto.open;
  const originalSetRequestHeader = proto.setRequestHeader;
  const originalSend = proto.send;
  const states = new WeakMap<XMLHttpRequest, XhrState>();

  proto.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
    // a reused XHR must not keep the details of its previous request
    states.delete(this);
    const result = (originalOpen as (...a: unknown[]) => void).apply(
      this,
      args,
    );
    if (recorder.enabled) {
      try {
        const base =
          typeof location !== "undefined" ? location.href : undefined;
        const raw = String(args[1]);
        let url = raw;
        try {
          url = new URL(raw, base).toString();
        } catch {
          // keep as given
        }
        states.set(this, {
          method: String(args[0]).toUpperCase(),
          url,
          headers: [],
        });
      } catch {
        // recording must not matter
      }
    }
    return result;
  } as typeof proto.open;

  proto.setRequestHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    const result = originalSetRequestHeader.call(this, name, value);
    const state = states.get(this);
    if (state) state.headers.push([name, value]);
    return result;
  };

  proto.send = function (
    this: XMLHttpRequest,
    body?: XMLHttpRequestBodyInit | null,
  ) {
    const state = states.get(this);
    if (state && recorder.enabled) {
      try {
        state.body = summarizeBody(body);
        const start = now();
        this.addEventListener(
          "loadend",
          () => {
            try {
              record(this, state, start);
            } catch {
              // recording must not matter
            }
          },
          { once: true },
        );
      } catch {
        // recording must not matter
      }
    }
    return originalSend.call(this, body);
  };

  /** Build and store the entry for a finished request. */
  function record(request: XMLHttpRequest, state: XhrState, start: number) {
    const responseHeaders = parseRawHeaders(request.getAllResponseHeaders());
    const length = Number(findHeader(responseHeaders, "content-length"));
    let size = Number.isFinite(length) ? length : undefined;
    let preview: string | undefined;

    const type = request.responseType;
    if (type === "" || type === "text") {
      const text = request.responseText;
      if (
        text.length <= RESPONSE_PREVIEW_MAX_BYTES &&
        isTextContentType(findHeader(responseHeaders, "content-type"))
      ) {
        preview = truncateText(text).text;
      }
    } else if (type === "arraybuffer" && request.response) {
      size ??= (request.response as ArrayBuffer).byteLength;
    } else if (type === "blob" && request.response) {
      size ??= (request.response as Blob).size;
    }

    recorder.record({
      kind: "http",
      source: "xhr",
      method: state.method,
      url: state.url,
      host: hostOf(state.url),
      start,
      end: now(),
      status: request.status || undefined,
      statusText: request.statusText || undefined,
      error: request.status === 0 ? "network error or aborted" : undefined,
      requestHeaders: state.headers,
      responseHeaders,
      requestBody: state.body ?? { kind: "none" },
      responseSize: size,
      responsePreview: preview,
    });
  }
}
