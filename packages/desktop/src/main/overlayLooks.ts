import type { OverlayElements } from "../shared/ipc";

/** Compact preset: avatars and the mute badge only. */
export const COMPACT_ELEMENTS: OverlayElements = {
  overlayAvatar: "always",
  overlayName: "off",
  overlayLive: "off",
  overlayStatus: "always",
  overlayWatching: "off",
};

/** Detailed preset, the default. */
export const DETAILED_ELEMENTS: OverlayElements = {
  overlayAvatar: "always",
  overlayName: "speaking",
  overlayLive: "always",
  overlayStatus: "always",
  overlayWatching: "always",
};

/**
 * Element visibilities for the removed `overlayStyle` setting, used to
 * migrate config files that still have it.
 *
 * @param style The stored `overlayStyle`, anything if the file had none
 * @returns The Compact preset for "compact", else the Detailed preset
 */
export function overlayElementsFromStyle(style: unknown): OverlayElements {
  return { ...(style === "compact" ? COMPACT_ELEMENTS : DETAILED_ELEMENTS) };
}
