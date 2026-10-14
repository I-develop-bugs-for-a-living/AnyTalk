import { describe, expect, it } from "vitest";

import { keyOfEvent, typedCharOf } from "./keybindSequences";

/** Fake keyboard event */
const fake = (code: string, key: string, numLock: boolean) =>
  ({
    code,
    key,
    getModifierState: (name: string) => name === "NumLock" && numLock,
  }) as unknown as KeyboardEvent;

describe("keyOfEvent", () => {
  it("uses the code for numpad keys with NumLock on", () => {
    expect(keyOfEvent(fake("Numpad9", "9", true))).toBe("Numpad9");
    expect(keyOfEvent(fake("NumpadAdd", "+", true))).toBe("NumpadAdd");
    expect(keyOfEvent(fake("NumpadEnter", "Enter", true))).toBe("NumpadEnter");
  });

  it("keeps the code when Shift changes the key with NumLock on", () => {
    expect(keyOfEvent(fake("Numpad9", "PageUp", true))).toBe("Numpad9");
  });

  it("falls back to event.key with NumLock off", () => {
    expect(keyOfEvent(fake("Numpad8", "ArrowUp", false))).toBe("ArrowUp");
    expect(keyOfEvent(fake("Numpad4", "ArrowLeft", false))).toBe("ArrowLeft");
    expect(keyOfEvent(fake("Numpad9", "PageUp", false))).toBe("PageUp");
  });

  it("lowercases letters and keeps other keys", () => {
    expect(keyOfEvent(fake("KeyM", "M", false))).toBe("m");
    expect(keyOfEvent(fake("Digit9", "9", false))).toBe("9");
    expect(keyOfEvent(fake("F5", "F5", false))).toBe("F5");
  });
});

describe("typedCharOf", () => {
  it("maps numpad keys to the character they type", () => {
    expect(typedCharOf("Numpad4")).toBe("4");
    expect(typedCharOf("NumpadAdd")).toBe("+");
    expect(typedCharOf("NumpadEnter")).toBe("NumpadEnter");
  });

  it("leaves other keys alone", () => {
    expect(typedCharOf("a")).toBe("a");
    expect(typedCharOf("ArrowLeft")).toBe("ArrowLeft");
  });
});
