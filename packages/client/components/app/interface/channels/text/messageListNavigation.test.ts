import { describe, expect, it } from "vitest";

import {
  isMessageNavKey,
  messagePageSize,
  nextMessageIndex,
  tabStopIndex,
} from "./messageListNavigation";

const plain = {
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
};

describe("isMessageNavKey", () => {
  it("accepts navigation keys without modifiers", () => {
    expect(isMessageNavKey({ ...plain, key: "ArrowUp" })).toBe(true);
    expect(isMessageNavKey({ ...plain, key: "PageDown" })).toBe(true);
  });

  it("ignores other keys and modifier combinations", () => {
    expect(isMessageNavKey({ ...plain, key: "a" })).toBe(false);
    expect(isMessageNavKey({ ...plain, altKey: true, key: "ArrowUp" })).toBe(
      false,
    );
    expect(isMessageNavKey({ ...plain, shiftKey: true, key: "Home" })).toBe(
      false,
    );
  });
});

describe("messagePageSize", () => {
  it("fits a screenful minus one", () => {
    expect(messagePageSize(600, 60)).toBe(9);
  });

  it("is at least one", () => {
    expect(messagePageSize(50, 60)).toBe(1);
    expect(messagePageSize(0, 60)).toBe(1);
    expect(messagePageSize(600, 0)).toBe(1);
  });
});

describe("nextMessageIndex", () => {
  it("moves one message and stops at the edges", () => {
    expect(nextMessageIndex(5, 2, "ArrowUp", 3)).toBe(1);
    expect(nextMessageIndex(5, 2, "ArrowDown", 3)).toBe(3);
    expect(nextMessageIndex(5, 0, "ArrowUp", 3)).toBe(0);
    expect(nextMessageIndex(5, 4, "ArrowDown", 3)).toBe(4);
  });

  it("jumps with Home, End and the page keys", () => {
    expect(nextMessageIndex(10, 5, "Home", 3)).toBe(0);
    expect(nextMessageIndex(10, 5, "End", 3)).toBe(9);
    expect(nextMessageIndex(10, 5, "PageUp", 3)).toBe(2);
    expect(nextMessageIndex(10, 8, "PageDown", 3)).toBe(9);
  });

  it("starts from the newest message when nothing is focused", () => {
    expect(nextMessageIndex(4, -1, "ArrowUp", 3)).toBe(3);
    expect(nextMessageIndex(4, -1, "Home", 3)).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(nextMessageIndex(0, -1, "ArrowDown", 3)).toBe(-1);
  });
});

describe("tabStopIndex", () => {
  it("keeps the last focused message", () => {
    expect(tabStopIndex(["a", "b", "c"], "b")).toBe(1);
  });

  it("falls back to the newest message", () => {
    expect(tabStopIndex(["a", "b", "c"], undefined)).toBe(2);
    expect(tabStopIndex(["a", "b", "c"], "gone")).toBe(2);
    expect(tabStopIndex([], "a")).toBe(-1);
  });
});
