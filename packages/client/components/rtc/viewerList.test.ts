import { describe, expect, it } from "vitest";

import { otherViewers } from "./viewerList";

describe("otherViewers", () => {
  it("leaves out ourselves", () => {
    expect(otherViewers(["a", "me", "b"], "me")).toEqual(["a", "b"]);
  });

  it("removes duplicates", () => {
    expect(otherViewers(["a", "a", "b"], "me")).toEqual(["a", "b"]);
  });

  it("keeps everyone without a local identity", () => {
    expect(otherViewers(["a", "b"])).toEqual(["a", "b"]);
  });

  it("handles no viewers", () => {
    expect(otherViewers([], "me")).toEqual([]);
  });
});
