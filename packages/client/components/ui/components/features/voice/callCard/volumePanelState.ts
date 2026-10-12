import { createSignal } from "solid-js";

/**
 * Whether the device has no mouse to hover with, e.g. phones
 */
export const touchOnly = () => !matchMedia("(hover: hover)").matches;

const [openPanels, setOpenPanels] = createSignal(0);

/**
 * Whether any volume panel is open. The panels float outside the call card,
 * so the call card's auto-hiding controls must stay awake while one is open.
 */
export const volumePanelOpen = () => openPanels() > 0;

/**
 * Report a volume panel opening (true) or closing (false)
 */
export function trackVolumePanel(open: boolean) {
  setOpenPanels((count) => Math.max(0, count + (open ? 1 : -1)));
}
