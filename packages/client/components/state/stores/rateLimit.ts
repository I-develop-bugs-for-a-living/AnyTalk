/**
 * Result of recognising a rate limit rejection.
 */
export type RateLimitInfo = {
  /** `rateLimit` is the per-session send limit, `slowmode` the channel slowmode */
  kind: "rateLimit" | "slowmode";
  /** Milliseconds until the next request is allowed, if the server said so */
  retryAfterMs?: number;
};

/** Longest time a notice suppresses further notices (the server window is 10 s) */
export const MAX_NOTICE_WINDOW_MS = 10_000;

/** Shortest time a notice suppresses further notices */
export const MIN_NOTICE_WINDOW_MS = 4_000;

/**
 * Work out whether an error thrown by the Stoat api client is a rate limit
 * or slowmode rejection. stoat-api throws the raw response body text for
 * failed requests (the status code is lost). The rate limiter answers with
 * `{"retry_after": <milliseconds>}` and slowmode with
 * `{"type":"InSlowmode","retry_after":<seconds>}`.
 * @param error Whatever was thrown by the request
 * @returns Info about the rejection, or undefined if this is another error
 */
export function parseRateLimitError(error: unknown): RateLimitInfo | undefined {
  let body: unknown = error;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }

  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;

  const retryAfter =
    typeof record.retry_after === "number" &&
    Number.isFinite(record.retry_after)
      ? record.retry_after
      : undefined;
  const type = typeof record.type === "string" ? record.type : undefined;

  if (type === "InSlowmode") {
    return {
      kind: "slowmode",
      retryAfterMs: retryAfter === undefined ? undefined : retryAfter * 1000,
    };
  }

  const isRateLimitType =
    type === "RateLimited" ||
    type === "TooManyRequests" ||
    record.status === 429;

  // an error with another explicit type is not the rate limiter
  if (type && !isRateLimitType) return undefined;
  if (!isRateLimitType && retryAfter === undefined) return undefined;

  return { kind: "rateLimit", retryAfterMs: retryAfter };
}

/** Time until which further notices are suppressed (shared by all channels) */
let noticeUntil = 0;

/**
 * Decide whether a notice should be shown for a blocked message. Only the
 * first blocked message of a burst gets one, across all channels.
 * @param info Rejection info
 * @param now Current time in milliseconds
 * @returns Whether to show a notice
 */
export function claimRateLimitNotice(info: RateLimitInfo, now: number) {
  if (now < noticeUntil) return false;
  noticeUntil =
    now +
    Math.min(
      MAX_NOTICE_WINDOW_MS,
      Math.max(MIN_NOTICE_WINDOW_MS, info.retryAfterMs ?? 0),
    );
  return true;
}

/**
 * Reset the notice throttle (for tests).
 */
export function resetRateLimitNotice() {
  noticeUntil = 0;
}

/**
 * Convert a retry time to whole seconds for display.
 * @param info Rejection info
 * @returns Seconds (at least 1), or undefined if unknown
 */
export function retryAfterSeconds(info: RateLimitInfo) {
  return info.retryAfterMs
    ? Math.max(1, Math.ceil(info.retryAfterMs / 1000))
    : undefined;
}

/** Most upload attempts (first try included) for one file */
export const MAX_UPLOAD_ATTEMPTS = 3;

/** Longest wait (ms) we accept before retrying a rate limited upload */
export const MAX_UPLOAD_RETRY_WAIT_MS = 30_000;

/** Shortest wait (ms) before retrying a rate limited upload */
export const MIN_UPLOAD_RETRY_WAIT_MS = 1000;

/** Wait (ms) used when Autumn answers 429 without a usable delay */
export const DEFAULT_UPLOAD_RETRY_WAIT_MS = 10_000;

/**
 * Read the retry delay of a rate limited Autumn upload. Autumn answers 429
 * with the header `X-RateLimit-Reset-After` and the body
 * `{"retry_after": <n>}`, both in milliseconds.
 * @param header Value of the `X-RateLimit-Reset-After` response header
 * @param body Parsed (or raw text) response body
 * @returns Milliseconds to wait, or undefined if the server gave none
 */
export function parseUploadRetryDelay(
  header: string | null | undefined,
  body: unknown,
): number | undefined {
  const trimmed = header?.trim();
  const fromHeader = trimmed ? Number(trimmed) : NaN;
  if (Number.isFinite(fromHeader) && fromHeader >= 0) return fromHeader;

  let parsed = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (parsed && typeof parsed === "object") {
    const value = (parsed as Record<string, unknown>).retry_after;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Decide what to do after a rate limited upload attempt.
 * @param attempt Number of attempts made so far (at least 1)
 * @param retryAfterMs Delay from the server, if any
 * @returns Wait time in ms to retry after, or undefined to give up
 */
export function decideUploadRetry(
  attempt: number,
  retryAfterMs: number | undefined,
): number | undefined {
  if (attempt >= MAX_UPLOAD_ATTEMPTS) return undefined;
  const wait = Math.max(
    MIN_UPLOAD_RETRY_WAIT_MS,
    retryAfterMs ?? DEFAULT_UPLOAD_RETRY_WAIT_MS,
  );
  if (wait > MAX_UPLOAD_RETRY_WAIT_MS) return undefined;
  // small margin so the window has really passed
  return wait + 250;
}
