import { describe, expect, it } from "vitest";

import {
  sequenceToAccelerator,
  sequenceToGlobalAccelerator,
} from "./accelerator";

describe("sequenceToAccelerator", () => {
  it("converts modifiers and letters", () => {
    expect(sequenceToAccelerator(["Control", "Shift", "m"])).toBe(
      "Ctrl+Shift+M",
    );
    expect(sequenceToAccelerator(["Meta", "Alt", "d"])).toBe("Alt+Super+D");
  });

  it("orders modifiers consistently", () => {
    expect(sequenceToAccelerator(["m", "Shift", "Control"])).toBe(
      "Ctrl+Shift+M",
    );
  });

  it("converts digits, function keys, arrows and space", () => {
    expect(sequenceToAccelerator(["Control", "5"])).toBe("Ctrl+5");
    expect(sequenceToAccelerator(["F12"])).toBe("F12");
    expect(sequenceToAccelerator(["Alt", "ArrowUp"])).toBe("Alt+Up");
    expect(sequenceToAccelerator(["Control", " "])).toBe("Ctrl+Space");
    expect(sequenceToAccelerator(["Control", "+"])).toBe("Ctrl+Plus");
  });

  it("rejects RegExp entries", () => {
    expect(sequenceToAccelerator([/^[^ ]$/])).toBeNull();
    expect(sequenceToAccelerator(["Control", /a/])).toBeNull();
  });

  it("rejects modifier-only and multi-key sequences", () => {
    expect(sequenceToAccelerator(["Control", "Shift"])).toBeNull();
    expect(sequenceToAccelerator([])).toBeNull();
    expect(sequenceToAccelerator(["Control", "a", "b"])).toBeNull();
  });

  it("rejects unknown keys", () => {
    expect(sequenceToAccelerator(["Control", "Dead"])).toBeNull();
    expect(sequenceToAccelerator(["Control", "F25"])).toBeNull();
  });
});

describe("sequenceToGlobalAccelerator", () => {
  it("accepts a modifier with a key", () => {
    expect(sequenceToGlobalAccelerator(["Control", "m"])).toBe("Ctrl+M");
    expect(sequenceToGlobalAccelerator(["Shift", "F5"])).toBe("Shift+F5");
  });

  it("accepts a bare function key", () => {
    expect(sequenceToGlobalAccelerator(["F12"])).toBe("F12");
  });

  it("rejects keys without a modifier", () => {
    expect(sequenceToGlobalAccelerator(["m"])).toBeNull();
    expect(sequenceToGlobalAccelerator(["5"])).toBeNull();
    expect(sequenceToGlobalAccelerator([" "])).toBeNull();
  });

  it("rejects what sequenceToAccelerator rejects", () => {
    expect(sequenceToGlobalAccelerator(["Control", "Shift"])).toBeNull();
    expect(sequenceToGlobalAccelerator(["Control", /a/])).toBeNull();
  });
});
