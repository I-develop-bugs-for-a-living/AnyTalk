import { describe, expect, it, vi } from "vitest";

// the module reads the desktop bridge when loaded
vi.hoisted(() => vi.stubGlobal("window", {}));

import { COMPACT_ELEMENTS, DETAILED_ELEMENTS, presetOf } from "./overlayConfig";

describe("presetOf", () => {
  it("recognises both presets", () => {
    expect(presetOf(COMPACT_ELEMENTS)).toBe("compact");
    expect(presetOf(DETAILED_ELEMENTS)).toBe("detailed");
  });

  it("is custom when a single value differs", () => {
    expect(presetOf({ ...DETAILED_ELEMENTS, overlayName: "always" })).toBe(
      "custom",
    );
  });
});
