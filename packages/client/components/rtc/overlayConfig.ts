import { createSignal } from "solid-js";

/** The overlay settings the desktop shell stores */
type OverlaySettings = Pick<
  DesktopConfig,
  "overlayEnabled" | "overlayCorner" | "overlayMode" | "overlayStyle"
>;

/** Settings of the desktop shell right now, defaults when missing */
const initial = window.desktopConfig?.get?.();
const [enabled, setEnabled] = createSignal(initial?.overlayEnabled === true);
const [corner, setCorner] = createSignal(initial?.overlayCorner ?? "top-left");
const [mode, setMode] = createSignal(initial?.overlayMode ?? "games");
const [style, setStyle] = createSignal(initial?.overlayStyle ?? "detailed");

/** Whether the overlay is turned on */
export const overlayEnabled = enabled;
/** Corner the overlay sits in */
export const overlayCorner = corner;
/** When the overlay shows */
export const overlayMode = mode;
/** How much the overlay shows */
export const overlayStyle = style;

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
    setStyle(next.overlayStyle ?? "detailed");
    return true;
  } catch (err) {
    console.error("[overlay] could not save settings", err);
    return false;
  }
}
