import { createMemo, createSignal } from "solid-js";

/** When one overlay element shows */
export type OverlayVisibility = "always" | "speaking" | "off";

/** The per-element overlay settings, one config key each */
export type OverlayElements = {
  overlayAvatar: OverlayVisibility;
  overlayName: OverlayVisibility;
  overlayLive: OverlayVisibility;
  overlayStatus: OverlayVisibility;
  overlayWatching: OverlayVisibility;
};

/** Compact preset: avatars and the mute badge only (copy of the desktop one) */
export const COMPACT_ELEMENTS: OverlayElements = {
  overlayAvatar: "always",
  overlayName: "off",
  overlayLive: "off",
  overlayStatus: "always",
  overlayWatching: "off",
};

/** Detailed preset, the default (copy of the desktop one) */
export const DETAILED_ELEMENTS: OverlayElements = {
  overlayAvatar: "always",
  overlayName: "speaking",
  overlayLive: "always",
  overlayStatus: "always",
  overlayWatching: "always",
};

/**
 * Which preset the element settings match.
 * @param elements The five element settings
 * @returns The preset name, or "custom" when they match neither
 */
export function presetOf(
  elements: OverlayElements,
): "compact" | "detailed" | "custom" {
  const matches = (preset: OverlayElements) =>
    (Object.keys(preset) as (keyof OverlayElements)[]).every(
      (key) => elements[key] === preset[key],
    );
  if (matches(COMPACT_ELEMENTS)) return "compact";
  if (matches(DETAILED_ELEMENTS)) return "detailed";
  return "custom";
}

/** The overlay settings the desktop shell stores */
type OverlaySettings = Pick<
  DesktopConfig,
  "overlayEnabled" | "overlayCorner" | "overlayMode"
> &
  OverlayElements;

/** Settings of the desktop shell right now, defaults when missing */
const initial = window.desktopConfig?.get?.();
const [enabled, setEnabled] = createSignal(initial?.overlayEnabled === true);
const [corner, setCorner] = createSignal(initial?.overlayCorner ?? "top-left");
const [mode, setMode] = createSignal(initial?.overlayMode ?? "games");
const [avatar, setAvatar] = createSignal(
  initial?.overlayAvatar ?? DETAILED_ELEMENTS.overlayAvatar,
);
const [name, setName] = createSignal(
  initial?.overlayName ?? DETAILED_ELEMENTS.overlayName,
);
const [live, setLive] = createSignal(
  initial?.overlayLive ?? DETAILED_ELEMENTS.overlayLive,
);
const [status, setStatus] = createSignal(
  initial?.overlayStatus ?? DETAILED_ELEMENTS.overlayStatus,
);
const [watching, setWatching] = createSignal(
  initial?.overlayWatching ?? DETAILED_ELEMENTS.overlayWatching,
);

/** Whether the overlay is turned on */
export const overlayEnabled = enabled;
/** Corner the overlay sits in */
export const overlayCorner = corner;
/** When the overlay shows */
export const overlayMode = mode;
/** When the avatar shows */
export const overlayAvatar = avatar;
/** When the name shows */
export const overlayName = name;
/** When the LIVE indicator shows */
export const overlayLive = live;
/** When the mute and deafen badge shows */
export const overlayStatus = status;
/** When the "watching your stream" eye shows */
export const overlayWatching = watching;
/** Preset the element settings match, "custom" when neither */
export const overlayPreset = createMemo(() =>
  presetOf({
    overlayAvatar: avatar(),
    overlayName: name(),
    overlayLive: live(),
    overlayStatus: status(),
    overlayWatching: watching(),
  }),
);

/**
 * Whether this desktop shell has the overlay, older builds lack the bridge
 * @returns True in a desktop build that can show the overlay
 */
export function overlayAvailable(): boolean {
  return typeof window.native?.setOverlayState === "function";
}

/**
 * Save overlay settings in the desktop shell. The signals follow what the
 * shell stored, so the settings page and the hotkey stay in step.
 * @param partial Settings to change
 * @returns Whether the shell accepted them
 */
export async function saveOverlaySettings(
  partial: Partial<OverlaySettings>,
): Promise<boolean> {
  try {
    const next = await window.desktopConfig.set(partial);
    setEnabled(next.overlayEnabled === true);
    setCorner(next.overlayCorner ?? "top-left");
    setMode(next.overlayMode ?? "games");
    setAvatar(next.overlayAvatar ?? DETAILED_ELEMENTS.overlayAvatar);
    setName(next.overlayName ?? DETAILED_ELEMENTS.overlayName);
    setLive(next.overlayLive ?? DETAILED_ELEMENTS.overlayLive);
    setStatus(next.overlayStatus ?? DETAILED_ELEMENTS.overlayStatus);
    setWatching(next.overlayWatching ?? DETAILED_ELEMENTS.overlayWatching);
    return true;
  } catch (err) {
    console.error("[overlay] could not save settings", err);
    return false;
  }
}
