import { describe, expect, it } from "vitest";

import { codeOfKey, invertLayout } from "./keyCodes";

describe("codeOfKey", () => {
  const layout = invertLayout(
    new Map([
      ["KeyZ", "z"],
      ["KeyY", "y"],
      ["Digit1", "1"],
      ["Backquote", "`"],
      ["IntlA", "x"],
      ["IntlB", "x"],
    ]),
  );

  it("maps layout independent keys directly", () => {
    expect(codeOfKey("F5")).toBe("F5");
    expect(codeOfKey("Numpad7")).toBe("Numpad7");
    expect(codeOfKey("NumpadEnter")).toBe("NumpadEnter");
    expect(codeOfKey(" ")).toBe("Space");
    expect(codeOfKey("PageUp")).toBe("PageUp");
  });

  it("uses the layout for characters", () => {
    expect(codeOfKey("z", layout)).toBe("KeyZ");
    expect(codeOfKey("Z", layout)).toBe("KeyZ");
    expect(codeOfKey("1", layout)).toBe("Digit1");
  });

  it("gives nothing when unknown or ambiguous", () => {
    expect(codeOfKey("z")).toBeUndefined();
    expect(codeOfKey("q", layout)).toBeUndefined();
    expect(codeOfKey("x", layout)).toBeUndefined();
  });
});
