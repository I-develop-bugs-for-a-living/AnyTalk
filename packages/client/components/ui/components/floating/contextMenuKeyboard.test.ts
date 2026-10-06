import { describe, expect, it } from "vitest";

import {
  findContextMenuElement,
  isContextMenuKey,
  keyboardMenuAnchor,
} from "./contextMenuKeyboard";

const noMods = {
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
};

describe("isContextMenuKey", () => {
  it("accepts the ContextMenu key and Shift+F10", () => {
    expect(isContextMenuKey({ ...noMods, key: "ContextMenu" })).toBe(true);
    expect(isContextMenuKey({ ...noMods, key: "F10", shiftKey: true })).toBe(
      true,
    );
  });

  it("rejects plain F10, other keys and extra modifiers", () => {
    expect(isContextMenuKey({ ...noMods, key: "F10" })).toBe(false);
    expect(isContextMenuKey({ ...noMods, key: "Enter" })).toBe(false);
    expect(
      isContextMenuKey({
        ...noMods,
        key: "F10",
        shiftKey: true,
        ctrlKey: true,
      }),
    ).toBe(false);
  });
});

describe("keyboardMenuAnchor", () => {
  const viewport = { width: 1000, height: 800 };
  const rect = { left: 100, right: 300, top: 50, bottom: 90 };

  it("goes below the element, at its start edge", () => {
    const anchor = keyboardMenuAnchor(rect, false, viewport);
    expect(anchor.placement).toBe("bottom-start");
    expect(anchor.rect).toMatchObject({
      x: 100,
      y: 50,
      width: 200,
      height: 40,
    });
  });

  it("mirrors for right-to-left", () => {
    expect(keyboardMenuAnchor(rect, true, viewport).placement).toBe(
      "bottom-end",
    );
  });

  it("cuts the rectangle to the viewport", () => {
    const anchor = keyboardMenuAnchor(
      { left: -50, right: 2000, top: -10, bottom: 5000 },
      false,
      viewport,
    );
    expect(anchor.rect).toMatchObject({
      left: 0,
      right: 1000,
      top: 0,
      bottom: 800,
    });
  });

  it("never gives a negative size for an element outside the viewport", () => {
    const anchor = keyboardMenuAnchor(
      { left: 1500, right: 1600, top: 900, bottom: 950 },
      false,
      viewport,
    );
    expect(anchor.rect.width).toBe(0);
    expect(anchor.rect.height).toBe(0);
  });
});

describe("findContextMenuElement", () => {
  type Node = { name: string; parentElement: Node | null };
  const root: Node = { name: "root", parentElement: null };
  const mid: Node = { name: "mid", parentElement: root };
  const leaf: Node = { name: "leaf", parentElement: mid };

  it("returns the closest match, including the start element", () => {
    expect(findContextMenuElement(leaf, () => true)).toBe(leaf);
    expect(
      findContextMenuElement(leaf, (el) => el.name === "mid" || el === root),
    ).toBe(mid);
  });

  it("returns undefined when nothing matches", () => {
    expect(findContextMenuElement(leaf, () => false)).toBeUndefined();
    expect(findContextMenuElement(null, () => true)).toBeUndefined();
  });
});
