import { describe, expect, it } from "vitest";

import { isSwipeDown, shouldCloseOnSwipe } from "./userProfileSwipe";

describe("isSwipeDown", () => {
  it("accepts a vertical pull at the top", () => {
    expect(isSwipeDown(0, 5, 40)).toBe(true);
  });

  it("ignores pulls when the page was scrolled", () => {
    expect(isSwipeDown(30, 0, 80)).toBe(false);
  });

  it("ignores small movements inside the dead zone", () => {
    expect(isSwipeDown(0, 0, 5)).toBe(false);
  });

  it("ignores upward and mostly horizontal drags", () => {
    expect(isSwipeDown(0, 0, -20)).toBe(false);
    expect(isSwipeDown(0, 80, 40)).toBe(false);
  });
});

describe("shouldCloseOnSwipe", () => {
  it("closes after a long pull", () => {
    expect(shouldCloseOnSwipe(130, 900)).toBe(true);
  });

  it("closes after a short quick flick", () => {
    expect(shouldCloseOnSwipe(70, 100)).toBe(true);
  });

  it("stays open for a short slow pull", () => {
    expect(shouldCloseOnSwipe(70, 800)).toBe(false);
    expect(shouldCloseOnSwipe(30, 20)).toBe(false);
  });
});
