import { createSignal } from "solid-js";

import { registerSW } from "virtual:pwa-register";

import { hardReload } from "@revolt/common/lib/hardReload";

import { findEntryScript, isNewBuild } from "./updateCheck";

/** How often to look for a new version while the app stays open */
const CHECK_INTERVAL = 36e5;

/** Shortest time between checks triggered by returning to the app */
const FOCUS_THROTTLE = 5 * 6e4;

/** How long to wait for the new worker to take over before a hard reload */
const ACTIVATE_TIMEOUT = 4000;

const [updateAvailable, setAvailable] = createSignal(false);
const [noticeDismissed, setNoticeDismissed] = createSignal(false);

/**
 * Mark a new version as found; a dismissed notice shows again for it
 */
function setUpdateAvailable(value: boolean) {
  setAvailable(value);
  if (value) setNoticeDismissed(false);
}

/**
 * Whether a new version of the app has been found and is ready to apply
 */
export { updateAvailable };

/**
 * Whether the user closed the update notice since the last update was found
 */
export { noticeDismissed };

/**
 * Hide the update notice until the next update is found
 */
export function dismissUpdateNotice() {
  setNoticeDismissed(true);
}

/** Interval and timeout handles started by this module */
const startTimers: ReturnType<typeof setTimeout>[] = [];

/** Whether the hourly check is already running */
let hourlyStarted = false;

/**
 * Start the hourly check once, however often the worker reports it is
 * registered
 */
function startHourlyCheck() {
  if (hourlyStarted) return;
  hourlyStarted = true;
  startTimers.push(setInterval(() => runCheck(0), CHECK_INTERVAL));
}

/** Starts a check for a new version, set up by the web or desktop path */
let checkForUpdate: (() => Promise<void> | void) | undefined;

/** Time of the last check, for throttling */
let lastCheck = 0;

/**
 * The entry script of the running page, to compare with the server's.
 * Missing in the dev server, where nothing is checked.
 */
const currentEntry = Array.from(document.scripts)
  .map((s) => findEntryScript(s.src))
  .find(Boolean);

/**
 * Look for a new version now, at most once per throttle window unless forced
 */
function runCheck(throttle: number) {
  // nothing to run yet (the worker is still registering)
  if (!checkForUpdate) return;
  const now = Date.now();
  if (now - lastCheck < throttle) return;
  lastCheck = now;
  Promise.resolve(checkForUpdate()).catch(() => {});
}

/**
 * The desktop app has no service worker: fetch the page without cache and
 * see whether it points to a different entry script
 */
async function checkDesktopUpdate() {
  if (!navigator.onLine) return;
  const response = await fetch("/", { cache: "no-store" });
  if (!response.ok) return;
  if (isNewBuild(currentEntry, findEntryScript(await response.text()))) {
    setUpdateAvailable(true);
  }
}

/**
 * The desktop app loads the site from a server, and clears old service
 * workers on start, so it doesn't register one
 */
const updateSW = window.native
  ? undefined
  : registerSW({
      onNeedRefresh() {
        setUpdateAvailable(true);
      },
      onOfflineReady() {
        console.info("Ready to work offline =)");
        // toast to users
      },
      onRegistered(r) {
        if (!r) return;
        checkForUpdate = async () => {
          await r.update();
        };
        startHourlyCheck();
      },
    });

if (window.native) {
  checkForUpdate = checkDesktopUpdate;
  startHourlyCheck();
  // first check shortly after start, the page may be older than the server
  startTimers.push(setTimeout(() => runCheck(0), 30000));
}

/** Handlers of the focus listeners, kept to remove them on hot reload */
const onVisibility = () => {
  if (document.visibilityState === "visible") runCheck(FOCUS_THROTTLE);
};
const onFocus = () => runCheck(FOCUS_THROTTLE);

// check again when coming back to the app
document.addEventListener("visibilitychange", onVisibility);
window.addEventListener("focus", onFocus);

// a hot reload re-runs this module, so don't leave the old timers and
// listeners behind
import.meta.hot?.dispose(() => {
  startTimers.forEach((t) => {
    clearInterval(t);
    clearTimeout(t);
  });
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("focus", onFocus);
});

/**
 * Switch to the new version. On the web the waiting worker takes over and
 * the page reloads; if that doesn't happen soon, caches are cleared and the
 * page is reloaded the hard way. The desktop app has no worker, so a reload
 * already loads the new build.
 */
export function applyUpdate() {
  if (!updateSW) {
    location.reload();
    return;
  }

  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const container = navigator.serviceWorker;

  /** The new worker is in control, the page reloads on its own */
  const stop = () => {
    done = true;
    clearTimeout(timer);
    container?.removeEventListener("controllerchange", stop);
    document.removeEventListener("visibilitychange", arm);
  };

  /** Clear caches and reload the hard way */
  const fallback = () => {
    if (done) return;
    stop();
    hardReload().then((started) => {
      if (!started) location.reload();
    });
  };

  /** Start the wait, only while the page is visible (timers lag when hidden) */
  function arm() {
    clearTimeout(timer);
    if (document.visibilityState === "visible") {
      timer = setTimeout(fallback, ACTIVATE_TIMEOUT);
    }
  }

  container?.addEventListener("controllerchange", stop);
  document.addEventListener("visibilitychange", arm);
  arm();
  // a failed activation goes straight to the fallback
  updateSW(true).catch(fallback);
}

/**
 * Dev only: pretend an update was found, to look at the notice
 * (run `window.__showUpdateNotice()` in the console)
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__showUpdateNotice = () =>
    setUpdateAvailable(true);
}
