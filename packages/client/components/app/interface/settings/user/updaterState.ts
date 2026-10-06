import { createSignal } from "solid-js";

/** Latest state of the desktop auto-updater, undefined until it answered */
const [updaterState, setUpdaterState] = createSignal<UpdaterState>();

export { updaterState };

/** Whether we already listen to the updater */
let watching = false;

/**
 * Start following the desktop updater (once). Does nothing in the browser or
 * in older desktop versions without an updater.
 */
export function watchUpdater() {
  const updater = window.desktopUpdater;
  if (watching || !updater) return;
  watching = true;

  try {
    // intentionally never unsubscribed: lives for the whole session (the sidebar dot needs it)
    updater.onState(setUpdaterState);
    updater
      .getState()
      .then((state) => setUpdaterState((current) => current ?? state))
      .catch((err) => console.error("[updater] could not read state", err));
  } catch (err) {
    console.error("[updater] could not follow the updater", err);
  }
}

/**
 * Whether an update is waiting to be downloaded or installed
 */
export function updateWaiting() {
  const status = updaterState()?.status;
  return status === "available" || status === "downloaded";
}
