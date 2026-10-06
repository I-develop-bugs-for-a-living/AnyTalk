import { describe, expect, it } from "vitest";

import {
  isTypeAheadKey,
  nextMenuIndex,
  submenuKeys,
  typeAheadIndex,
} from "./menuKeyboard";

describe("nextMenuIndex", () => {
  it("moves down and wraps", () => {
    expect(nextMenuIndex(3, 0, "ArrowDown")).toBe(1);
    expect(nextMenuIndex(3, 2, "ArrowDown")).toBe(0);
  });

  it("moves up and wraps", () => {
    expect(nextMenuIndex(3, 2, "ArrowUp")).toBe(1);
    expect(nextMenuIndex(3, 0, "ArrowUp")).toBe(2);
  });

  it("starts at the first or last item when nothing is focused", () => {
    expect(nextMenuIndex(3, -1, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(3, -1, "ArrowUp")).toBe(2);
  });

  it("supports Home and End", () => {
    expect(nextMenuIndex(4, 2, "Home")).toBe(0);
    expect(nextMenuIndex(4, 1, "End")).toBe(3);
  });

  it("ignores other keys and empty menus", () => {
    expect(nextMenuIndex(3, 0, "a")).toBeUndefined();
    expect(nextMenuIndex(0, -1, "ArrowDown")).toBeUndefined();
  });
});

describe("typeAheadIndex", () => {
  const labels = ["Edit", "Delete", "Dismiss", "Report"];

  it("finds the next item starting with the letter", () => {
    expect(typeAheadIndex(labels, 0, "d")).toBe(1);
    expect(typeAheadIndex(labels, 1, "d")).toBe(2);
    expect(typeAheadIndex(labels, 2, "d")).toBe(1);
  });

  it("matches a longer prefix from the focused item", () => {
    expect(typeAheadIndex(labels, 1, "di")).toBe(2);
    expect(typeAheadIndex(labels, -1, "re")).toBe(3);
  });

  it("is case insensitive and returns undefined without a match", () => {
    expect(typeAheadIndex(labels, -1, "R")).toBe(3);
    expect(typeAheadIndex(labels, -1, "z")).toBeUndefined();
    expect(typeAheadIndex([], -1, "a")).toBeUndefined();
  });
});

describe("submenuKeys", () => {
  it("flips in right-to-left layouts", () => {
    expect(submenuKeys(false)).toEqual({
      open: "ArrowRight",
      close: "ArrowLeft",
    });
    expect(submenuKeys(true)).toEqual({
      open: "ArrowLeft",
      close: "ArrowRight",
    });
  });
});

describe("isTypeAheadKey", () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false };

  it("accepts plain characters only", () => {
    expect(isTypeAheadKey({ ...base, key: "a" })).toBe(true);
    expect(isTypeAheadKey({ ...base, key: " " })).toBe(false);
    expect(isTypeAheadKey({ ...base, key: "Enter" })).toBe(false);
    expect(isTypeAheadKey({ ...base, key: "a", ctrlKey: true })).toBe(false);
  });
});
