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

/**
 * Games running on this computer, kept up to date while the calling component
 * lives. Empty outside the desktop app and while detection is off.
 */
export function createRunningGames(): Accessor<RunningGame[]> {
  const [games, setGames] = createSignal<RunningGame[]>([]);

  createEffect(() => {
    if (!gameDetectionAvailable()) {
      setGames([]);
      return;
    }

    let active = true;
    // a slow first read must not overwrite a newer update
    let updated = false;
    fetchRunningGames().then((list) => active && !updated && setGames(list));
    const stop = subscribeRunningGames((list) => {
      updated = true;
      if (active) setGames(list);
    });
    onCleanup(() => {
      active = false;
      stop();
    });
  });

  return games;
}
