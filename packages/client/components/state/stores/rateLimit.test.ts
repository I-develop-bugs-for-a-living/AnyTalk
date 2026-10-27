import { beforeEach, describe, expect, it } from "vitest";

import {
  claimRateLimitNotice,
  decideUploadRetry,
  parseRateLimitError,
  parseUploadRetryDelay,
  resetRateLimitNotice,
  retryAfterSeconds,
} from "./rateLimit";

describe("parseRateLimitError", () => {
  it("reads the rate limiter body in milliseconds", () => {
    expect(parseRateLimitError('{"retry_after":1500}')).toEqual({
      kind: "rateLimit",
      retryAfterMs: 1500,
    });
  });

  it("reads slowmode in seconds", () => {
    expect(
      parseRateLimitError('{"type":"InSlowmode","retry_after":5}'),
    ).toEqual({ kind: "slowmode", retryAfterMs: 5000 });
  });

  it("recognises typed errors and Response-like objects", () => {
    expect(parseRateLimitError({ type: "RateLimited" })).toEqual({
      kind: "rateLimit",
      retryAfterMs: undefined,
    });
    expect(parseRateLimitError({ status: 429, ok: false })).toEqual({
      kind: "rateLimit",
      retryAfterMs: undefined,
    });
  });

  it("ignores other errors", () => {
    expect(parseRateLimitError("")).toBeUndefined();
    expect(parseRateLimitError("Upload Error")).toBeUndefined();
    expect(parseRateLimitError('{"retry_after":"soon"}')).toBeUndefined();
    expect(parseRateLimitError({ retry_after: NaN })).toBeUndefined();
    expect(
      parseRateLimitError(new TypeError("Failed to fetch")),
    ).toBeUndefined();
    expect(parseRateLimitError('{"type":"NotFound"}')).toBeUndefined();
    expect(parseRateLimitError({ status: 500 })).toBeUndefined();
    expect(parseRateLimitError(undefined)).toBeUndefined();
  });
});

describe("claimRateLimitNotice", () => {
  beforeEach(resetRateLimitNotice);

  it("allows one notice per burst and caps the window at 10 s", () => {
    const info = { kind: "rateLimit", retryAfterMs: 60_000 } as const;
    expect(claimRateLimitNotice(info, 1000)).toBe(true);
    expect(claimRateLimitNotice(info, 5000)).toBe(false);
    expect(claimRateLimitNotice(info, 11_001)).toBe(true);
  });

  it("uses at least 4 s without a retry time", () => {
    const info = { kind: "rateLimit" } as const;
    expect(claimRateLimitNotice(info, 0)).toBe(true);
    expect(claimRateLimitNotice(info, 3999)).toBe(false);
    expect(claimRateLimitNotice(info, 4000)).toBe(true);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up and handles unknown", () => {
    expect(retryAfterSeconds({ kind: "rateLimit", retryAfterMs: 1200 })).toBe(
      2,
    );
    expect(retryAfterSeconds({ kind: "rateLimit", retryAfterMs: 10 })).toBe(1);
    expect(retryAfterSeconds({ kind: "rateLimit" })).toBeUndefined();
  });
});

describe("upload retry", () => {
  it("prefers the header, falls back to the body", () => {
    expect(parseUploadRetryDelay("4000", { retry_after: 1 })).toBe(4000);
    expect(parseUploadRetryDelay(null, { retry_after: 2500 })).toBe(2500);
    expect(parseUploadRetryDelay(undefined, '{"retry_after":900}')).toBe(900);
    expect(parseUploadRetryDelay("  ", { retry_after: 700 })).toBe(700);
    expect(parseUploadRetryDelay("", { retry_after: 700 })).toBe(700);
    expect(parseUploadRetryDelay(" 3000 ", null)).toBe(3000);
    expect(parseUploadRetryDelay("abc", null)).toBeUndefined();
    expect(parseUploadRetryDelay(null, "nope")).toBeUndefined();
  });

  it("retries short waits and gives up on long ones or too many tries", () => {
    expect(decideUploadRetry(1, 2000)).toBe(2250);
    expect(decideUploadRetry(1, 0)).toBe(1250);
    expect(decideUploadRetry(2, undefined)).toBe(10_250);
    expect(decideUploadRetry(1, 30_001)).toBeUndefined();
    expect(decideUploadRetry(3, 1000)).toBeUndefined();
  });
});
