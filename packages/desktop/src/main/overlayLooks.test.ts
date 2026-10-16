import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPACT_ELEMENTS,
  DETAILED_ELEMENTS,
  overlayElementsFromStyle,
} from "./overlayLooks.ts";

describe("overlayElementsFromStyle", () => {
  it("maps compact to the Compact preset", () => {
    assert.deepEqual(overlayElementsFromStyle("compact"), COMPACT_ELEMENTS);
  });

  it("maps detailed, missing and unknown values to the Detailed preset", () => {
    for (const style of ["detailed", undefined, 5, "other"])
      assert.deepEqual(overlayElementsFromStyle(style), DETAILED_ELEMENTS);
  });

  it("returns a copy", () => {
    overlayElementsFromStyle("compact").overlayName = "always";
    assert.equal(COMPACT_ELEMENTS.overlayName, "off");
  });
});
