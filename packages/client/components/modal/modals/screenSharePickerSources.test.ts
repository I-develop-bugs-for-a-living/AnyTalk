import { describe, expect, it } from "vitest";

import { PickerSourceItem, mergeSources } from "./screenSharePickerSources";

const a: PickerSourceItem = {
  idx: 0,
  name: "A",
  isFullScreen: false,
  image: "a",
};
const b: PickerSourceItem = {
  idx: 1,
  name: "B",
  isFullScreen: false,
  image: "b",
};

describe("mergeSources", () => {
  it("returns the same list when nothing changed", () => {
    const prev = [a, b];
    expect(mergeSources(prev, [{ ...a }, { ...b }], true)).toBe(prev);
  });

  it("keeps unchanged objects and order, and appends new ones", () => {
    const c = { idx: 2, name: "C", isFullScreen: false };
    const result = mergeSources([a, b], [c, { ...a }], true);
    expect(result).toEqual([a, b, c]);
    expect(result[0]).toBe(a);
  });

  it("keeps a source missing from the poll, unchanged", () => {
    const result = mergeSources([a, b], [{ ...b }], true);
    expect(result).toEqual([a, b]);
    expect(result[0]).toBe(a);
  });

  it("keeps old images on icon-only polls", () => {
    const result = mergeSources([a], [{ ...a, image: "icon" }], false);
    expect(result[0]).toBe(a);
  });

  it("takes new thumbnails and renames", () => {
    const result = mergeSources(
      [a],
      [{ ...a, name: "A2", image: "new" }],
      true,
    );
    expect(result).toEqual([{ ...a, name: "A2", image: "new" }]);
  });

  it("uses the icon for a source that had no image", () => {
    const bare = { idx: 3, name: "D", isFullScreen: false };
    expect(
      mergeSources([bare], [{ ...bare, image: "icon" }], false)[0].image,
    ).toBe("icon");
  });
});
