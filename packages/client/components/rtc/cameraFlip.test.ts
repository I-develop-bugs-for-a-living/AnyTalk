import { describe, expect, it } from "vitest";

import { nextDeviceId, oppositeFacingMode } from "./cameraFlip";

describe("oppositeFacingMode", () => {
  it("flips between front and back", () => {
    expect(oppositeFacingMode("user")).toBe("environment");
    expect(oppositeFacingMode("environment")).toBe("user");
  });

  it("gives nothing for unknown modes", () => {
    expect(oppositeFacingMode(undefined)).toBeUndefined();
    expect(oppositeFacingMode("left")).toBeUndefined();
  });
});

describe("nextDeviceId", () => {
  it("cycles and wraps around", () => {
    expect(nextDeviceId(["a", "b", "c"], "a")).toBe("b");
    expect(nextDeviceId(["a", "b", "c"], "c")).toBe("a");
  });

  it("starts at the first when the current one is unknown", () => {
    expect(nextDeviceId(["a", "b"], "x")).toBe("a");
    expect(nextDeviceId(["a", "b"])).toBe("a");
  });

  it("gives nothing with fewer than two cameras", () => {
    expect(nextDeviceId(["a"], "a")).toBeUndefined();
    expect(nextDeviceId([])).toBeUndefined();
  });
});
