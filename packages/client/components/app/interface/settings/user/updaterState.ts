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

/** Whether the user closed the desktop update card on the start page this session */
const [desktopNoticeDismissed, setDesktopNoticeDismissed] = createSignal(false);

export { desktopNoticeDismissed };

/**
 * Hide the desktop update card on the start page until the app restarts
 */
export function dismissDesktopNotice() {
  setDesktopNoticeDismissed(true);
}

/**
 * Whether a desktop update is fully downloaded and only needs a restart
 */
export function desktopUpdateDownloaded() {
  return updaterState()?.status === "downloaded";
}

/**
 * Pick which update card the start page shows. A downloaded desktop update
 * wins over a web update, because the restart loads the new web content too.
 *
 * @param desktop A desktop update is downloaded and not dismissed
 * @param web A web update is waiting and not dismissed
 */
export function pickUpdateNotice(
  desktop: boolean,
  web: boolean,
): "desktop" | "web" | undefined {
  if (desktop) return "desktop";
  if (web) return "web";
  return undefined;
}
