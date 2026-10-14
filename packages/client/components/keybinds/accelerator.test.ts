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

  it("converts numpad keys", () => {
    expect(sequenceToAccelerator(["Numpad9"])).toBe("num9");
    expect(sequenceToAccelerator(["Control", "Numpad0"])).toBe("Ctrl+num0");
    expect(sequenceToAccelerator(["NumpadAdd"])).toBe("numadd");
    expect(sequenceToAccelerator(["NumpadSubtract"])).toBe("numsub");
    expect(sequenceToAccelerator(["NumpadMultiply"])).toBe("nummult");
    expect(sequenceToAccelerator(["NumpadDivide"])).toBe("numdiv");
    expect(sequenceToAccelerator(["NumpadDecimal"])).toBe("numdec");
    expect(sequenceToAccelerator(["NumpadEnter"])).toBe("Enter");
    expect(sequenceToAccelerator(["Numpad9", "9"])).toBeNull();
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

  it("accepts bare numpad and navigation keys", () => {
    expect(sequenceToGlobalAccelerator(["Numpad9"])).toBe("num9");
    expect(sequenceToGlobalAccelerator(["NumpadAdd"])).toBe("numadd");
    expect(sequenceToGlobalAccelerator(["Insert"])).toBe("Insert");
    expect(sequenceToGlobalAccelerator(["PageDown"])).toBe("PageDown");
    expect(sequenceToGlobalAccelerator(["ScrollLock"])).toBe("Scrolllock");
  });

  it("rejects bare numpad Enter and other typing keys", () => {
    expect(sequenceToGlobalAccelerator(["NumpadEnter"])).toBeNull();
    expect(sequenceToGlobalAccelerator(["Enter"])).toBeNull();
    expect(sequenceToGlobalAccelerator(["Delete"])).toBeNull();
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
