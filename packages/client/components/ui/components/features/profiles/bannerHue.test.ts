import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BANNER_HUE_PRESETS,
  bannerHue,
  emptyBannerColour,
  resetRelativeColourSupportCache,
  validBannerHue,
} from "./bannerHue";

const HUE_OF_KNOWN_ID = 116;

describe("bannerHue", () => {
  it("returns the same hue for the same id", () => {
    expect(bannerHue("01HABCDEF")).toBe(bannerHue("01HABCDEF"));
  });

  it("keeps a known id on its current hue", () => {
    expect(bannerHue("01HABCDEF")).toBe(HUE_OF_KNOWN_ID);
  });

  it("stays within 0-359 as an integer", () => {
    for (let i = 0; i < 500; i++) {
      const hue = bannerHue(`01H${i}XYZ`);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("never lands in the muddy 35-114 band", () => {
    for (let i = 0; i < 5000; i++) {
      const hue = bannerHue(`01H${i}ID${i * 7}`);
      expect(hue < 35 || hue >= 115).toBe(true);
    }
  });

  it("spreads different ids over many hues", () => {
    const hues = new Set<number>();
    for (let i = 0; i < 200; i++) hues.add(bannerHue(`user-${i}`));
    expect(hues.size).toBeGreaterThan(100);
  });
});

describe("emptyBannerColour", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRelativeColourSupportCache();
  });

  it("uses the hue when relative colours are supported", () => {
    resetRelativeColourSupportCache();
    vi.stubGlobal("CSS", { supports: () => true });
    expect(emptyBannerColour("a")).toBe(
      `oklch(from var(--md-sys-color-primary-container) l c ${bannerHue("a")})`,
    );
  });

  it("falls back when supports returns false", () => {
    resetRelativeColourSupportCache();
    vi.stubGlobal("CSS", { supports: () => false });
    expect(emptyBannerColour("a")).toBe(
      "var(--md-sys-color-primary-container)",
    );
  });

  it("falls back when CSS is undefined", () => {
    resetRelativeColourSupportCache();
    vi.stubGlobal("CSS", undefined);
    expect(emptyBannerColour("a")).toBe(
      "var(--md-sys-color-primary-container)",
    );
  });
});

describe("validBannerHue", () => {
  it("accepts integers from 0 to 359", () => {
    expect(validBannerHue(0)).toBe(0);
    expect(validBannerHue(210)).toBe(210);
    expect(validBannerHue(359)).toBe(359);
  });

  it("rejects everything else", () => {
    for (const bad of [
      -1,
      360,
      1.5,
      NaN,
      Infinity,
      "210",
      null,
      undefined,
      {},
    ]) {
      expect(validBannerHue(bad)).toBeUndefined();
    }
  });

  it("keeps presets valid and outside the muddy band", () => {
    for (const hue of Object.values(BANNER_HUE_PRESETS)) {
      expect(validBannerHue(hue)).toBe(hue);
      expect(hue < 35 || hue >= 115).toBe(true);
    }
  });
});

describe("emptyBannerColour with a chosen hue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRelativeColourSupportCache();
  });

  it("uses the chosen hue, even inside the muddy band", () => {
    resetRelativeColourSupportCache();
    vi.stubGlobal("CSS", { supports: () => true });
    expect(emptyBannerColour("a", 60)).toBe(
      "oklch(from var(--md-sys-color-primary-container) l c 60)",
    );
  });

  it("uses the automatic hue for an invalid one", () => {
    resetRelativeColourSupportCache();
    vi.stubGlobal("CSS", { supports: () => true });
    expect(emptyBannerColour("a", 400)).toBe(emptyBannerColour("a"));
  });
});
