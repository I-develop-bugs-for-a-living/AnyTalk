import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECENT_CALLS_SHOWN,
  clampRecentCallsShown,
  cleanRecentCalls,
  pushRecentCall,
} from "./recentCalls";

describe("pushRecentCall", () => {
  it("puts the newest first and removes duplicates", () => {
    expect(pushRecentCall(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("keeps at most ten", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(pushRecentCall(ids, "k")).toEqual(["k", ...ids.slice(0, 9)]);
  });
});

describe("cleanRecentCalls", () => {
  it("drops invalid data", () => {
    expect(cleanRecentCalls(undefined)).toEqual({});
    expect(cleanRecentCalls({ u: "x", v: ["a", 1, "a", "b"] })).toEqual({
      v: ["a", "b"],
    });
  });
});

describe("clampRecentCallsShown", () => {
  it("keeps values from 0 to 10 and rounds", () => {
    expect(clampRecentCallsShown(0)).toBe(0);
    expect(clampRecentCallsShown(3.6)).toBe(4);
    expect(clampRecentCallsShown(99)).toBe(10);
    expect(clampRecentCallsShown(-2)).toBe(0);
  });

  it("falls back to the default for anything else", () => {
    expect(clampRecentCallsShown("7")).toBe(DEFAULT_RECENT_CALLS_SHOWN);
    expect(clampRecentCallsShown(NaN)).toBe(DEFAULT_RECENT_CALLS_SHOWN);
    expect(clampRecentCallsShown(undefined)).toBe(DEFAULT_RECENT_CALLS_SHOWN);
  });
});
