/**
 * First hue (degrees) of the range banners may use. Hues from 35 up to this
 * value (dark orange to yellow) look muddy brown or olive on the dark theme's
 * primary container, so they are never returned.
 */
const BANNER_HUE_START = 115;

/**
 * Number of degrees available from `BANNER_HUE_START` onwards. 280 covers
 * hues 115 up to 394 (wrapping past 360 to 34), which skips the excluded
 * 35-114 band.
 */
const BANNER_HUE_SPAN = 280;

/**
 * Map a user id to a stable hue between 0 and 359, used to tint empty
 * profile banners. Uses a 32-bit FNV-1a string hash, spread evenly over
 * the allowed hue range (the muddy 35-114 band is skipped).
 * @param userId User id
 * @returns Hue in degrees (integer, 0-359)
 */
export function bannerHue(userId: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  // `>>> 0` turns the signed result into an unsigned 32-bit number
  return (BANNER_HUE_START + ((hash >>> 0) % BANNER_HUE_SPAN)) % 360;
}

/** Cached result of the relative colour support probe (null until first use) */
let relativeColourSupported: boolean | null = null;

/**
 * Whether the browser supports CSS relative colour syntax. Probed with a
 * literal value (a `var()` would always count as valid) and cached after
 * the first call.
 * @returns True if relative colours are supported
 */
function supportsRelativeColour(): boolean {
  if (relativeColourSupported === null) {
    relativeColourSupported =
      typeof CSS !== "undefined" &&
      CSS.supports("color", "oklch(from red l c 0)");
  }
  return relativeColourSupported;
}

/**
 * Reset the cached support probe. Only meant for tests.
 */
export function resetRelativeColourSupportCache() {
  relativeColourSupported = null;
}

/**
 * Background colour for a profile banner without an image: the theme's
 * primary container with its hue swapped for the user's hue. Falls back to
 * the plain primary container where relative colour syntax is unsupported.
 * A user-chosen colour can replace the result here later.
 * @param userId User id
 * @returns CSS colour value
 */
export function emptyBannerColour(userId: string): string {
  return supportsRelativeColour()
    ? `oklch(from var(--md-sys-color-primary-container) l c ${bannerHue(userId)})`
    : "var(--md-sys-color-primary-container)";
}
