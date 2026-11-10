import { createSignal } from "solid-js";

/** Latest state of the desktop auto-updater, undefined until it answered */
const [updaterState, setRawState] = createSignal<UpdaterState>();

/** Last non-empty update version seen, for states that may lack it */
let lastVersion: string | undefined;

/**
 * Fill in the version of a state that lacks it while an update is in
 * progress, so dismissing keeps working during the download.
 *
 * @param state New state from the updater
 * @param last Last non-empty version seen
 */
export function withVersion(
  state: UpdaterState,
  last: string | undefined,
): UpdaterState {
  if (state.version || !last) return state;
  if (state.status === "downloading" || state.status === "error") {
    return { ...state, version: last };
  }
  return state;
}

/**
 * Store a state from the updater. A changed status clears an old failure.
 *
 * @param state New state from the updater
 */
function setUpdaterState(state: UpdaterState) {
  const next = withVersion(state, lastVersion);
  if (next.version) lastVersion = next.version;
  if (next.status !== updaterState()?.status) setUpdateFailed(false);
  setRawState(next);
}

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
      .then((state) => {
        if (!updaterState()) setUpdaterState(state);
      })
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

/** Version key of the desktop update card the user closed this session */
const [desktopNoticeDismissed, setDesktopNoticeDismissed] = createSignal<
  string | undefined
>();

export { desktopNoticeDismissed };

/**
 * Key that identifies a desktop update for dismissing: the version plus
 * whether it is ready to install. Closing the "available" card therefore
 * does not hide the later "restart" card, and a newer version shows again.
 *
 * @param state Current updater state
 */
export function desktopNoticeKey(state: UpdaterState | undefined) {
  const phase = state?.status === "downloaded" ? "ready" : "pending";
  return `${state?.version ?? ""}:${phase}`;
}

/**
 * Hide the desktop update card on the start page until the app restarts
 */
export function dismissDesktopNotice() {
  setUpdateFailed(false);
  setDesktopNoticeDismissed(desktopNoticeKey(updaterState()));
}

/**
 * Whether a desktop update is fully downloaded and only needs a restart
 */
export function desktopUpdateDownloaded() {
  return updaterState()?.status === "downloaded";
}

/** What the desktop update card offers, depending on the updater state */
export type DesktopAction = "restart" | "download" | "downloading" | "retry";

/** Which update the user is told about */
export type UpdateNotice =
  | { type: "web" }
  | { type: "desktop"; action: DesktopAction };

/**
 * Map the updater state to the action the card offers. Checking, up to date,
 * idle, unsupported and errors without a version offer nothing.
 *
 * @param state Current updater state
 */
export function desktopActionFor(
  state: UpdaterState | undefined,
): DesktopAction | undefined {
  switch (state?.status) {
    case "downloaded":
      return "restart";
    case "available":
      return "download";
    case "downloading":
      return "downloading";
    case "error":
      return state.version ? "retry" : undefined;
    default:
      return undefined;
  }
}

/**
 * Pick which update card to show. A desktop update wins over a web update,
 * because the restart loads the new web content too. Closing the desktop card
 * hides it without letting the web card take its place.
 *
 * @param state Desktop updater state
 * @param dismissedKey Key of the desktop update the user closed, if any
 * @param web A web update is waiting and not dismissed
 */
export function pickUpdateNotice(
  state: UpdaterState | undefined,
  dismissedKey: string | undefined,
  web: boolean,
): UpdateNotice | undefined {
  const action = desktopActionFor(state);
  if (action) {
    if (dismissedKey === desktopNoticeKey(state)) return undefined;
    return { type: "desktop", action };
  }
  return web ? { type: "web" } : undefined;
}

/** An update action is running (button disabled) */
const [updateBusy, setUpdateBusy] = createSignal(false);

/** The last update action could not be started */
const [updateFailed, setUpdateFailed] = createSignal(false);

export { updateBusy, updateFailed };

/** Forget a failed update attempt (the card changed or was closed) */
export function clearUpdateFailed() {
  setUpdateFailed(false);
}

/** Timer that re-enables the update button after a successful start */
let unlockTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Whether the shell reported that it started installing. Older desktop
 * versions return nothing, which counts as started.
 *
 * @param result Value returned by `desktopUpdater.install()`
 */
export function installStarted(result: unknown) {
  return result !== false;
}

/**
 * Run the action of an update card. Desktop actions go through the desktop
 * updater, the web update through the given reload function. Both the start
 * page and the title bar use this, so they share the busy and error state.
 *
 * @param notice Card the user pressed
 * @param applyWeb Reloads the web content
 */
export async function runUpdate(notice: UpdateNotice, applyWeb: () => void) {
  if (updateBusy()) return;
  clearTimeout(unlockTimer);
  setUpdateBusy(true);
  setUpdateFailed(false);

  // after a successful start the app restarts or reloads; if nothing happened
  // after a while, allow another try
  const unlock = () => {
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => setUpdateBusy(false), 10000);
  };

  try {
    if (notice.type === "web") {
      applyWeb();
      unlock();
      return;
    }

    const updater = window.desktopUpdater;
    if (!updater) throw new Error("no desktop updater");

    if (notice.action === "restart") {
      if (installStarted(await updater.install())) {
        unlock();
      } else {
        setUpdateFailed(true);
        setUpdateBusy(false);
      }
    } else {
      // progress arrives through the state, so the button is free right after
      await updater.download();
      setUpdateBusy(false);
    }
  } catch (err) {
    console.error("[updater] update action failed", err);
    setUpdateFailed(true);
    setUpdateBusy(false);
  }
}
