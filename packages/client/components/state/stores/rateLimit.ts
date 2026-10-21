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
