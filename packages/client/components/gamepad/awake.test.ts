import { describe, expect, it } from "vitest";

import { shouldWatchGamepads } from "./awake";

describe("shouldWatchGamepads", () => {
  it("watches when enabled, focused and visible", () => {
    expect(shouldWatchGamepads(true, true, "visible")).toBe(true);
  });

  it("does not watch when the setting is off", () => {
    expect(shouldWatchGamepads(false, true, "visible")).toBe(false);
  });

  it("does not watch when the window lost focus", () => {
    expect(shouldWatchGamepads(true, false, "visible")).toBe(false);
  });

  it("does not watch when the page is hidden", () => {
    expect(shouldWatchGamepads(true, true, "hidden")).toBe(false);
  });
});
