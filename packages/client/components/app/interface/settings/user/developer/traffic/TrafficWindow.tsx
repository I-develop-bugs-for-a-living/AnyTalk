import { Show, onCleanup, onMount } from "solid-js";

import { PopoutPortal } from "@revolt/rtc/PopoutPortal";

import { LiveView } from "./LiveView";
import { closeTrafficWindow, trafficWindow } from "./trafficWindow";

/**
 * Renders the live view into the inspector window while it is open. Mounted
 * once at the app's root, so the window outlives the settings screen. The
 * window closes when the app page goes away, and closing it from its own side
 * is noticed too.
 */
export function TrafficWindow() {
  onMount(() => {
    window.addEventListener("pagehide", closeTrafficWindow);
    onCleanup(() => {
      window.removeEventListener("pagehide", closeTrafficWindow);
      closeTrafficWindow();
    });
  });

  return (
    <Show when={trafficWindow()}>
      {(win) => (
        <PopoutPortal win={win()} onClose={closeTrafficWindow}>
          <LiveView popout />
        </PopoutPortal>
      )}
    </Show>
  );
}
