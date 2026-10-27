import type { TrafficRecorder } from "./recorder";
import {
  RESPONSE_PREVIEW_MAX_BYTES,
  findHeader,
  headersToList,
  hostOf,
  isTextContentType,
  summarizeBody,
  truncateText,
} from "./summarize";
import type { BodySummary, HeaderList } from "./types";

/** What is known about a request before it is sent. */
type PendingRequest = {
  method: string;
  url: string;
  headers: HeaderList;
  body: BodySummary;
  start: number;
};

/**
 * Describe the arguments of a `fetch` call. Never throws.
 */
function describeRequest(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  now: () => number,
): PendingRequest {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const base = typeof location !== "undefined" ? location.href : undefined;
  let url: string;
  if (isRequest) url = input.url;
  else if (typeof input === "string") url = input;
  else url = String(input);

  let absolute = url;
  try {
    absolute = new URL(url, base).toString();
  } catch {
    // keep as given
  }

  // Request headers first, init headers win per key
  const headers = headersToList(isRequest ? input.headers : undefined);
  for (const [name, value] of headersToList(init?.headers)) {
    const index = headers.findIndex(
      ([n]) => n.toLowerCase() === name.toLowerCase(),
    );
    if (index >= 0) headers.splice(index, 1);
    headers.push([name, value]);
  }

  let body: BodySummary;
  if (init && "body" in init && init.body !== undefined) {
    body = summarizeBody(init.body);
  } else if (isRequest && input.body) {
    body = { kind: "stream" };
  } else {
    body = { kind: "none" };
  }

  return {
    method: (init?.method ?? (isRequest ? input.method : "GET")).toUpperCase(),
    url: absolute,
    headers,
    body,
    start: now(),
  };
}

/**
 * Start reading a small text/JSON response body from a clone. The clone is made
 * synchronously (before the caller can read the body); only the text read is
 * async. Returns nothing for other responses.
 */
function startPreview(
  response: Response,
  headers: HeaderList,
): Promise<string | undefined> | undefined {
  const length = Number(findHeader(headers, "content-length"));
  if (
    !Number.isFinite(length) ||
    length <= 0 ||
    length > RESPONSE_PREVIEW_MAX_BYTES ||
    !isTextContentType(findHeader(headers, "content-type"))
  ) {
    return undefined;
  }
  try {
    return response
      .clone()
      .text()
      .then(
        (text) => truncateText(text).text,
        () => undefined,
      );
  } catch {
    return undefined;
  }
}

/**
 * Wrap `fetch` so requests are recorded while `recorder.enabled`. When off, the
 * call goes straight to the original. The returned promise is the original's
 * own, so results, errors and aborts are exactly what the caller would get.
 *
 * @param original The fetch to wrap
 * @param recorder Where entries go
 * @param now Clock, replaceable in tests
 */
export function wrapFetch(
  original: typeof fetch,
  recorder: TrafficRecorder,
  now: () => number = Date.now,
): typeof fetch {
  /** Recording fetch with the same signature and `this` handling as the original. */
  const wrapped = function (
    this: unknown,
    ...args: Parameters<typeof fetch>
  ): Promise<Response> {
    if (!recorder.enabled) return original.apply(this, args);

    let info: PendingRequest | undefined;
    try {
      info = describeRequest(args[0], args[1], now);
    } catch {
      return original.apply(this, args);
    }
    const request = info;

    // The caller gets this derived chain: it fulfils with the same response
    // and rejects with the same error, one microtask later than the original,
    // and stays "unhandled" if the caller ignores it.
    return original.apply(this, args).then(
      (response) => {
        try {
          const responseHeaders = headersToList(response.headers);
          const end = now();
          const length = Number(findHeader(responseHeaders, "content-length"));
          const preview = startPreview(response, responseHeaders);
          /** Store the entry, once the preview (if any) is read. */
          const store = (responsePreview?: string) => {
            try {
              recorder.record({
                kind: "http",
                source: "fetch",
                method: request.method,
                url: request.url,
                host: hostOf(request.url),
                start: request.start,
                end,
                status: response.status,
                statusText: response.statusText,
                requestHeaders: request.headers,
                responseHeaders,
                requestBody: request.body,
                responseSize: Number.isFinite(length) ? length : undefined,
                responsePreview,
              });
            } catch {
              // recording must not matter
            }
          };
          if (preview) void preview.then(store);
          else store();
        } catch {
          // recording must not matter
        }
        return response;
      },
      (error: unknown) => {
        try {
          recorder.record({
            kind: "http",
            source: "fetch",
            method: request.method,
            url: request.url,
            host: hostOf(request.url),
            start: request.start,
            end: now(),
            error: error instanceof Error ? error.name : String(error),
            requestHeaders: request.headers,
            responseHeaders: [],
            requestBody: request.body,
          });
        } catch {
          // recording must not matter
        }
        throw error;
      },
    );
  };
  return wrapped as typeof fetch;
}
