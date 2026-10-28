import { useDevice } from "@revolt/common";
import { useState } from "@revolt/state";

/**
 * Whether the phone bottom navigation bar is in use: the layout is a phone
 * and the user did not turn the bar off in the appearance settings.
 * @returns Accessor
 */
export function useBottomNav() {
  const device = useDevice();
  const state = useState();

  return () =>
    device.layout() === "phone" &&
    state.settings.getValue("appearance:bottom_nav");
}
