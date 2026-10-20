import { beforeEach, describe, expect, it } from "vitest";

import {
  claimRateLimitNotice,
  parseRateLimitError,
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
