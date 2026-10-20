import { describe, expect, it } from "vitest";

import { cleanPinnedIds, splitPinned } from "./pinOrder";

const list = (...ids: string[]) => ids.map((id) => ({ id }));

describe("cleanPinnedIds", () => {
  it("drops invalid entries and duplicates", () => {
    expect(cleanPinnedIds(["a", "", 3, null, "b", "a"])).toEqual(["a", "b"]);
  });

  it("handles non-arrays", () => {
    expect(cleanPinnedIds(undefined)).toEqual([]);
    expect(cleanPinnedIds("a")).toEqual([]);
  });
});

describe("splitPinned", () => {
  it("puts pinned first in pin order, then the rest unchanged", () => {
    const { pinned, rest } = splitPinned(list("a", "b", "c", "d"), ["c", "a"]);
    expect(pinned.map((c) => c.id)).toEqual(["c", "a"]);
    expect(rest.map((c) => c.id)).toEqual(["b", "d"]);
  });

  it("ignores stale ids", () => {
    const { pinned, rest } = splitPinned(list("a", "b"), ["x", "b"]);
    expect(pinned.map((c) => c.id)).toEqual(["b"]);
    expect(rest.map((c) => c.id)).toEqual(["a"]);
  });

  it("returns everything as rest with no pins", () => {
    const { pinned, rest } = splitPinned(list("a", "b"), []);
    expect(pinned).toEqual([]);
    expect(rest).toHaveLength(2);
  });
});
