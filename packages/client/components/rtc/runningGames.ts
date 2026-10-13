import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

/** Whether the user allows looking for running games (desktop setting) */
const [detectionOn, setDetectionOn] = createSignal(
  window.desktopConfig?.get?.().gameDetection !== false,
);

/**
 * Tell the client the "Detect running games" setting changed, so the lists
 * stop or start without a reload
 * @param value Whether detection is on
 */
export function setGameDetection(value: boolean) {
  setDetectionOn(value);
}

/**
 * Whether games can be detected: the desktop app has the bridge and the user
 * didn't turn detection off
 */
export function gameDetectionAvailable() {
  return (
    detectionOn() &&
    typeof window.native?.getRunningGames === "function" &&
    typeof window.native?.onRunningGamesChanged === "function"
  );
}

/**
 * Read the games running now
 * @returns The games, empty when detection is unavailable or fails
 */
export async function fetchRunningGames(): Promise<RunningGame[]> {
  if (!gameDetectionAvailable()) return [];
  try {
    return (await window.native.getRunningGames!()) ?? [];
  } catch (e) {
    console.debug("[games] could not read the running games:", e);
    return [];
  }
}

/**
 * Listen for changes of the running games (outside of a reactive scope)
 * @param cb Called with the games running after every change
 * @returns Function to stop listening
 */
export function subscribeRunningGames(
  cb: (games: RunningGame[]) => void,
): () => void {
  if (!gameDetectionAvailable()) return () => {};
  return window.native.onRunningGamesChanged!(cb);
}

/** How often the list is read again, in case an update was missed */
const REFRESH_MS = 30_000;

/**
 * Games running on this computer, kept up to date while the calling component
 * lives. Empty outside the desktop app and while detection is off.
 * @param refreshOn Read the list again whenever this changes (e.g. when a
 * followed game is released), so a missed update can't leave it stale
 */
export function createRunningGames(
  refreshOn?: Accessor<unknown>,
): Accessor<RunningGame[]> {
  const [games, setGames] = createSignal<RunningGame[]>([]);

  /** Keep the list, logging when it actually changed */
  let lastKey = "";
  const update = (list: RunningGame[]) => {
    const key = JSON.stringify(
      list.map((g) => [g.id, g.windows.map((w) => w.sourceId)]),
    );
    if (key !== lastKey) {
      lastKey = key;
      console.debug(
        "[games]",
        list.map((g) => `${g.name} (${g.windows.length} windows)`),
      );
    }
    setGames(list);
  };

  createEffect(() => {
    refreshOn?.();
    if (!gameDetectionAvailable()) {
      update([]);
      return;
    }

    let active = true;
    // a slow first read must not overwrite a newer update
    let updated = false;
    const read = () =>
      fetchRunningGames().then((list) => {
        if (active && !updated) update(list);
      });
    read();
    const stop = subscribeRunningGames((list) => {
      updated = true;
      if (active) update(list);
    });
    const timer = setInterval(() => {
      updated = false;
      read();
    }, REFRESH_MS);
    onCleanup(() => {
      active = false;
      clearInterval(timer);
      stop();
    });
  });

  return games;
}
