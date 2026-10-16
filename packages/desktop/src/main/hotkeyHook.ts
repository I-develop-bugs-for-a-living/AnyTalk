import { app, powerMonitor } from "electron";

import type { HotkeyBinding, HotkeyResult } from "../shared/ipc";
import {
  type HotkeyEdge,
  type HotkeyMatcher,
  type KeyTable,
  type MatcherBinding,
  type ModifierSet,
  createHotkeyMatcher,
  parseAccelerator,
} from "./hotkeyKeys";

/** The fields of a uiohook key event used here. */
type HookKeyEvent = {
  keycode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/** Modifier flags of a hook event. */
const modifiersOf = (e: HookKeyEvent): ModifierSet => ({
  ctrl: e.ctrlKey,
  alt: e.altKey,
  shift: e.shiftKey,
  meta: e.metaKey,
});

/** The parts of `uiohook-napi` used here. */
type UiohookModule = {
  uIOhook: {
    on(
      event: "keydown" | "keyup",
      listener: (e: HookKeyEvent) => void,
    ): unknown;
    start(): void;
    stop(): void;
  };
  UiohookKey: KeyTable;
};

/** Loaded module, `null` once loading failed, `undefined` before the first try. */
let loaded: UiohookModule | null | undefined;

/** Matcher fed by the hook, created together with the module. */
let matcher: HotkeyMatcher | undefined;

/** Latest `fire` callback, so the matcher always calls the current one. */
let currentFire: (action: string, edge: HotkeyEdge) => void = () => {};

/** Number of bindings the hook currently matches. */
let bindingCount = 0;

/** Whether the hook is running. */
let running = false;

/** Whether starting the hook failed, which makes it unusable. */
let startFailed = false;

/** Whether the `will-quit` and power cleanup was registered. */
let quitHooked = false;

/**
 * Load `uiohook-napi` on first use. It is a native module, so a missing or
 * broken binary must not stop the app, the caller falls back to
 * `globalShortcut`.
 *
 * @returns The module, or null if it can't be loaded here
 */
function load(): UiohookModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("uiohook-napi") as UiohookModule;
    const m = createHotkeyMatcher((action, edge) => currentFire(action, edge));
    mod.uIOhook.on("keydown", (e) => m.keyDown(e.keycode, modifiersOf(e)));
    mod.uIOhook.on("keyup", (e) => m.keyUp(e.keycode, modifiersOf(e)));
    matcher = m;
    loaded = mod;
  } catch (error) {
    console.warn("[hotkeys] keyboard hook unavailable:", error);
    loaded = null;
  }
  return loaded;
}

/**
 * Whether the keyboard hook can be used on this machine.
 *
 * @returns True if the native module loaded
 */
export function isHookAvailable(): boolean {
  return load() !== null && !startFailed;
}

/** Start the hook if it isn't running. */
function start(mod: UiohookModule) {
  if (running) return;
  try {
    mod.uIOhook.start();
    running = true;
  } catch (error) {
    console.warn("[hotkeys] keyboard hook failed to start:", error);
    startFailed = true;
    return;
  }
  if (!quitHooked) {
    quitHooked = true;
    app.on("will-quit", stopHook);
    // Key-ups are lost while the screen is locked or the machine sleeps
    const release = () => matcher?.releaseAll();
    // libuiohook keeps its own modifier mask, and a key-up lost while locked
    // leaves a modifier stuck in it. Restarting the hook re-reads the mask.
    const restart = () => {
      release();
      if (!running || !loaded) return;
      const mod = loaded;
      stopHook();
      start(mod);
    };
    powerMonitor.on("lock-screen", release);
    powerMonitor.on("suspend", release);
    powerMonitor.on("resume", restart);
    powerMonitor.on("unlock-screen", restart);
  }
}

/** Drop all bindings, release held actions and stop the hook. */
export function resetHook() {
  matcher?.setBindings([]);
  bindingCount = 0;
  stopHook();
}

/**
 * Check that the hook really starts, so capabilities don't promise key
 * releases it can't deliver. Without bindings it stops again right after.
 *
 * @returns True if the hook is running or started fine
 */
export function probeHook(): boolean {
  const mod = load();
  if (!mod || startFailed) return false;
  if (!running) {
    start(mod);
    if (startFailed) return false;
    if (bindingCount === 0) stopHook();
  }
  return true;
}

/** Release held actions and stop the hook. */
export function stopHook() {
  matcher?.releaseAll();
  if (!running || !loaded) return;
  running = false;
  try {
    loaded.uIOhook.stop();
  } catch {
    // Already stopped
  }
}

/**
 * Make the hook match the given bindings. Starts it when there are bindings
 * and stops it when there are none.
 *
 * @param bindings Wanted shortcuts
 * @param fire Called with the action and the edge
 * @returns Per binding, whether the hook can match it
 */
export function setHookBindings(
  bindings: HotkeyBinding[],
  fire: (action: string, edge: HotkeyEdge) => void,
): HotkeyResult[] {
  const mod = load();
  if (!mod || !matcher) {
    return bindings.map(({ action }) => ({ action, registered: false }));
  }
  currentFire = fire;

  const results: HotkeyResult[] = [];
  const parsedList: MatcherBinding[] = [];
  for (const { action, accelerator, code } of bindings) {
    const parsed = parseAccelerator(accelerator, mod.UiohookKey, code);
    if (parsed) parsedList.push({ action, parsed });
    results.push({ action, registered: parsed !== null });
  }
  matcher.setBindings(parsedList);
  bindingCount = parsedList.length;

  if (parsedList.length > 0) start(mod);
  else stopHook();
  if (startFailed) {
    matcher.setBindings([]);
    return results.map(({ action }) => ({ action, registered: false }));
  }
  return results;
}
