import { globalShortcut } from "electron";

import type { HotkeyBinding, HotkeyResult } from "../shared/ipc";

/** Accelerators currently registered, with the action each one fires. */
const registered = new Map<string, string>();

/** Latest `fire` callback, so kept shortcuts call the current one. */
let currentFire: (action: string) => void = () => {};

/** Forget what is registered, after `unregisterAll` ran elsewhere. */
export function resetGlobalHotkeys() {
  registered.clear();
}

/**
 * Make the registered global shortcuts match the given bindings. Unchanged
 * ones are left alone: on Wayland every change makes Chromium close and
 * recreate its portal session, so only the difference is applied.
 *
 * @param bindings Wanted shortcuts
 * @param fire Called with the action when a shortcut is pressed
 * @returns Per binding, whether registration worked
 */
export function setGlobalHotkeys(
  bindings: HotkeyBinding[],
  fire: (action: string) => void,
): HotkeyResult[] {
  currentFire = fire;
  const wanted = new Map(bindings.map((b) => [b.accelerator, b.action]));

  // Drop accelerators that are gone or now fire another action
  for (const [accelerator, action] of registered) {
    if (wanted.get(accelerator) === action) continue;
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // Invalid accelerator string
    }
    registered.delete(accelerator);
  }

  return bindings.map(({ action, accelerator }) => {
    if (registered.get(accelerator) === action)
      return { action, registered: true };
    let ok = false;
    try {
      // Returns false when another app owns the key or the platform refuses
      ok = globalShortcut.register(accelerator, () => currentFire(action));
    } catch {
      // Invalid accelerator string
    }
    if (ok) registered.set(accelerator, action);
    return { action, registered: ok };
  });
}
