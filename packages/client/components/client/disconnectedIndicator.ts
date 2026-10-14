import {
  Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import type { State } from "./Controller";

/** How long (ms) the client must stay disconnected before the UI shows it */
export const DISCONNECTED_GRACE_MS = 2_500;

/**
 * Whether a lifecycle state means "not connected" (including the states while
 * a connection is being made).
 * @param state Lifecycle state
 */
export function isDisconnectedState(state: State | `${State}`): boolean {
  return (
    state === "Connecting" ||
    state === "Disconnected" ||
    state === "Reconnecting" ||
    state === "Offline"
  );
}

/**
 * Create a signal telling the UI whether to show the "disconnected" look.
 * It turns on only after the client stayed disconnected for a short grace
 * period, so a quick reconnect does not flash it, and turns off at once when
 * the connection is back. Moving between Disconnected, Reconnecting and
 * Connecting does not restart the wait.
 * @param state Accessor of the current lifecycle state
 * @returns Accessor, true while the disconnected look should be shown
 */
export function createDisconnectedIndicator(
  state: Accessor<State | `${State}`>,
): Accessor<boolean> {
  const disconnected = createMemo(() => isDisconnectedState(state()));
  const [shown, setShown] = createSignal(false);

  createEffect(() => {
    if (!disconnected()) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), DISCONNECTED_GRACE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return shown;
}
