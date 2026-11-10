import { describe, expect, it } from "vitest";

import {
  clampPosition,
  defaultPosition,
  moveByKey,
  parseStoredPosition,
  passedDragThreshold,
} from "./callWindowPlacement";

const viewport = { width: 1000, height: 800 };
const size = { width: 300, height: 170 };
const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe("clampPosition", () => {
  it("keeps a position that fits", () => {
    expect(clampPosition({ x: 100, y: 100 }, size, viewport, none)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("keeps the window inside with a margin", () => {
    expect(clampPosition({ x: -50, y: -50 }, size, viewport, none)).toEqual({
      x: 16,
      y: 16,
    });
    expect(clampPosition({ x: 5000, y: 5000 }, size, viewport, none)).toEqual({
      x: 1000 - 16 - 300,
      y: 800 - 16 - 170,
    });
  });

  it("respects insets", () => {
    const insets = { top: 29, right: 0, bottom: 34, left: 0 };
    expect(clampPosition({ x: 0, y: 0 }, size, viewport, insets).y).toBe(45);
    expect(clampPosition({ x: 0, y: 9999 }, size, viewport, insets).y).toBe(
      800 - 34 - 16 - 170,
    );
  });

  it("prefers the top-left when the viewport is too small", () => {
    expect(
      clampPosition({ x: 50, y: 50 }, size, { width: 200, height: 100 }, none),
    ).toEqual({ x: 16, y: 16 });
  });
});

describe("defaultPosition", () => {
  it("is the top-right corner", () => {
    expect(defaultPosition(size, viewport, none)).toEqual({ x: 684, y: 72 });
  });
});

describe("passedDragThreshold", () => {
  it("ignores small movement", () => {
    expect(passedDragThreshold(2, 2)).toBe(false);
  });
  it("starts at 4px", () => {
    expect(passedDragThreshold(3, 3)).toBe(true);
  });
});

describe("moveByKey", () => {
  it("moves with arrow keys", () => {
    expect(moveByKey({ x: 10, y: 10 }, "ArrowLeft", 5)).toEqual({
      x: 5,
      y: 10,
    });
    expect(moveByKey({ x: 10, y: 10 }, "ArrowDown", 5)).toEqual({
      x: 10,
      y: 15,
    });
  });
  it("ignores other keys", () => {
    expect(moveByKey({ x: 10, y: 10 }, "a")).toBeUndefined();
  });
});

describe("parseStoredPosition", () => {
  it("reads a saved position", () => {
    expect(parseStoredPosition('{"x":1,"y":2}')).toEqual({ x: 1, y: 2 });
  });
  it("rejects bad data", () => {
    expect(parseStoredPosition(null)).toBeUndefined();
    expect(parseStoredPosition("nope")).toBeUndefined();
    expect(parseStoredPosition('{"x":"1","y":2}')).toBeUndefined();
    expect(parseStoredPosition("null")).toBeUndefined();
  });
});
