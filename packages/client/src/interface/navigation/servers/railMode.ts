import { useDevice } from "@revolt/common";
import Instance from "@revolt/instance/Instance";
import { useLocation } from "@revolt/routing";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";

/**
 * Whether the app uses the desktop layout. Phones and narrow windows (which
 * switch to the slide drawer) always keep the narrow, visible server rail.
 * @returns Accessor
 */
export function useRailDesktop() {
  const state = useState();
  const { isMobile } = useDevice();

  return () => !isMobile && !state.appDrawer();
}

/**
 * Whether the server rail shows names next to the icons (desktop layout only)
 * @returns Accessor
 */
export function useRailWide() {
  const state = useState();
  const desktop = useRailDesktop();

  return () =>
    desktop() && state.layout.getSectionState(LAYOUT_SECTIONS.RAIL_WIDE, false);
}

/**
 * Whether the server rail is hidden (desktop layout only). Discover is an
 * embedded page without a header to bring the rail back, so it always shows it.
 * @returns Accessor
 */
export function useRailHidden() {
  const state = useState();
  const desktop = useRailDesktop();
  const location = useLocation();

  return () =>
    desktop() &&
    !Instance.relPath(location.pathname).startsWith("/discover") &&
    state.layout.getSectionState(LAYOUT_SECTIONS.RAIL_HIDDEN, false);
}
