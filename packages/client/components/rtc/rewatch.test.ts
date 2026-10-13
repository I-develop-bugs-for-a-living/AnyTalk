import { describe, expect, it } from "vitest";

import { REWATCH_WINDOW_MS, shouldRewatch } from "./rewatch";

describe("shouldRewatch", () => {
  it("never rewatches a stream that did not end before", () => {
    expect(shouldRewatch(undefined, 1000)).toBe(false);
  });

  it("rewatches within the window", () => {
    expect(shouldRewatch(1000, 1000 + REWATCH_WINDOW_MS)).toBe(true);
    expect(shouldRewatch(1000, 5000)).toBe(true);
  });

  it("does not rewatch after the window", () => {
    expect(shouldRewatch(1000, 1001 + REWATCH_WINDOW_MS)).toBe(false);
  });
});

describe("shouldRewatch edge cases", () => {
  it("does not rewatch when the clock went back", () => {
    expect(shouldRewatch(5000, 4000)).toBe(false);
  });

  it("uses a custom window", () => {
    expect(shouldRewatch(1000, 1500, 500)).toBe(true);
    expect(shouldRewatch(1000, 1501, 500)).toBe(false);
  });
});
