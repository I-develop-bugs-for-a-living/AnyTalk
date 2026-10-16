import { describe, expect, it } from "vitest";

import { pickPopoutApi, POPOUT_MAX, popoutSize } from "./streamPopout";

describe("pickPopoutApi", () => {
  it("prefers Document Picture-in-Picture", () => {
    expect(pickPopoutApi({ documentPictureInPicture: {} }, false)).toBe("pip");
  });

  it("falls back to a popup", () => {
    expect(pickPopoutApi({}, false)).toBe("popup");
  });

  it("is unavailable on touch-only devices", () => {
    expect(pickPopoutApi({ documentPictureInPicture: {} }, true)).toBe(
      undefined,
    );
  });

  it("always uses a popup in the desktop app", () => {
    expect(
      pickPopoutApi({ documentPictureInPicture: {} }, false, true, true),
    ).toBe("popup");
  });

  it("is unavailable without any API", () => {
    expect(pickPopoutApi({}, false, false)).toBe(undefined);
  });
});

describe("popoutSize", () => {
  it("defaults to 16:9", () => {
    expect(popoutSize()).toEqual({ width: 960, height: 540 });
    expect(popoutSize({ width: 0, height: 0 })).toEqual({
      width: 960,
      height: 540,
    });
  });

  it("follows the stream's ratio", () => {
    expect(popoutSize({ width: 1920, height: 1080 })).toEqual({
      width: 960,
      height: 540,
    });
  });

  it("limits the height of tall streams", () => {
    const size = popoutSize({ width: 1080, height: 1920 });
    expect(size.height).toBe(POPOUT_MAX.height);
    expect(size.width).toBeLessThan(POPOUT_MAX.width);
  });

  it("keeps extreme shapes usable", () => {
    expect(popoutSize({ width: 10000, height: 10 }).height).toBe(320);
  });
});
