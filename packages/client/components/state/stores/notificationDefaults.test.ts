import { describe, expect, it } from "vitest";

import { resolveNewServerState } from "./notificationDefaults";

describe("resolveNewServerState", () => {
  it("writes the default when nothing is stored", () => {
    expect(resolveNewServerState(undefined, "all", "mention")).toBe("all");
    expect(resolveNewServerState(undefined, "none", "mention")).toBe("none");
  });

  it("writes nothing when the default equals the fallback", () => {
    expect(resolveNewServerState(undefined, "mention", "mention")).toBe(
      undefined,
    );
  });

  it("never overwrites an explicit value", () => {
    expect(resolveNewServerState("none", "all", "mention")).toBeUndefined();
    expect(resolveNewServerState("mention", "all", "mention")).toBeUndefined();
  });
});
