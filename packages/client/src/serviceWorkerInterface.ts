import { createSignal } from "solid-js";

import { registerSW } from "virtual:pwa-register";

const [pendingUpdate, setPendingUpdate] = createSignal<() => void>();

export { pendingUpdate };

/**
 * The desktop app loads the site from a server and shows its own update
 * flow, so it doesn't need the service worker or its update prompt
 */
const updateSW = window.native
  ? undefined
  : registerSW({
      onNeedRefresh() {
        setPendingUpdate(() => void updateSW?.(true));
      },
      onOfflineReady() {
        console.info("Ready to work offline =)");
        // toast to users
      },
      onRegistered(r) {
        // Check for updates every hour
        setInterval(() => r!.update(), 36e5);
      },
    });
