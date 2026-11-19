import { describe, expect, it } from "vitest";

import { encodeUnderLimit, previewSize } from "./streamPreview";

describe("previewSize", () => {
  it("scales down to the preview width and keeps the ratio", () => {
    expect(previewSize(1920, 1080)).toEqual({ width: 320, height: 180 });
  });

  it("does not scale small frames up", () => {
    expect(previewSize(200, 100)).toEqual({ width: 200, height: 100 });
  });

  it("rejects frames without size", () => {
    expect(previewSize(0, 100)).toBeUndefined();
    expect(previewSize(100, NaN)).toBeUndefined();
  });

  it("never returns a zero side", () => {
    expect(previewSize(10000, 1)?.height).toBe(1);
  });
});

describe("encodeUnderLimit", () => {
  it("lowers the quality until the image fits", async () => {
    const tried: number[] = [];
    const blob = await encodeUnderLimit(async (q) => {
      tried.push(q);
      return new Blob([new Uint8Array(q > 0.5 ? 500 : 50)]);
    }, 100);
    expect(blob?.size).toBe(50);
    expect(tried).toEqual([0.6, 0.45]);
  });

  it("gives up when nothing fits", async () => {
    const blob = await encodeUnderLimit(
      async () => new Blob([new Uint8Array(500)]),
      100,
    );
    expect(blob).toBeUndefined();
  });

  it("gives up when encoding fails", async () => {
    expect(await encodeUnderLimit(async () => null)).toBeUndefined();
  });
});
