import { globalShortcut } from "electron";

import type { HotkeyBinding, HotkeyResult } from "../shared/ipc";
import {
  isHookAvailable,
  probeHook,
  resetHook,
  setHookBindings,
} from "./hotkeyHook";
import type { HotkeyEdge } from "./hotkeyKeys";

/** Accelerators currently registered, with the action each one fires. */
const registered = new Map<string, string>();

/** Latest `fire` callback, so kept shortcuts call the current one. */
let currentFire: (action: string) => void = () => {};

/**
 * Whether hotkeys run on the low-level keyboard hook. Only on Windows:
 * `globalShortcut` takes the key from every other app there, and cannot see
 * releases. Elsewhere, or if the native module is missing, `globalShortcut`
 * is used.
 */
export function usesKeyboardHook(): boolean {
  return process.platform === "win32" && isHookAvailable();
}

/**
 * Whether key releases are reported: the hook is used and demonstrably
 * starts. Tries to start it, which is how a failure shows up early.
 */
export function hookReleaseSupported(): boolean {
  return process.platform === "win32" && probeHook();
}

/**
 * Forget what is registered, after `unregisterAll` ran elsewhere. Held
 * actions are released and the keyboard hook is stopped.
 */
export function resetGlobalHotkeys() {
  registered.clear();
  resetHook();
}

/**
 * Make the registered global shortcuts match the given bindings. Unchanged
 * ones are left alone: on Wayland every change makes Chromium close and
 * recreate its portal session, so only the difference is applied.
 *
 * @param bindings Wanted shortcuts
 * @param fire Called with the action and the edge. `globalShortcut` only
 * ever reports `down`, the keyboard hook also reports `up`.
 * @returns Per binding, whether registration worked
 */
export function setGlobalHotkeys(
  bindings: HotkeyBinding[],
  fire: (action: string, edge: HotkeyEdge) => void,
): HotkeyResult[] {
  if (usesKeyboardHook()) {
    // Drop anything an earlier fallback registered
    registered.clear();
    const results = setHookBindings(bindings, fire);
    // The hook may have failed to start just now, then fall through
    if (usesKeyboardHook()) return results;
  }

  currentFire = (action) => fire(action, "down");
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
