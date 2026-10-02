import { describe, expect, test } from "vitest";

import { State } from "..";

import { Voice, closestScreenShareResolution } from "./Voice";

describe("closestScreenShareResolution", () => {
  test("keeps an allowed resolution", () => {
    expect(
      closestScreenShareResolution("1080p", ["720p", "1080p", "source"]),
    ).toBe("1080p");
  });

  test("falls back to the closest smaller allowed resolution", () => {
    expect(
      closestScreenShareResolution("1440p", ["720p", "1080p", "source"]),
    ).toBe("1080p");
    expect(closestScreenShareResolution("source", ["720p"])).toBe("720p");
  });
});

describe("Voice store screen share settings", () => {
  const voice = new Voice({} as State);

  test("defaults to 1080p at 30 fps", () => {
    expect(voice.clean({})).toMatchObject({
      screenShareResolution: "1080p",
      screenShareFrameRate: 30,
    });
  });

  test("migrates the old combined quality setting", () => {
    expect(voice.clean({ screenShareQuality: "qhd60" } as never)).toMatchObject(
      { screenShareResolution: "1440p", screenShareFrameRate: 60 },
    );
    expect(voice.clean({ screenShareQuality: "text" } as never)).toMatchObject({
      screenShareResolution: "source",
      screenShareFrameRate: 5,
    });
  });

  test("rejects unknown values", () => {
    expect(
      voice.clean({
        screenShareResolution: "4k",
        screenShareFrameRate: 144,
      } as never),
    ).toMatchObject({
      screenShareResolution: "1080p",
      screenShareFrameRate: 30,
    });
  });
});
