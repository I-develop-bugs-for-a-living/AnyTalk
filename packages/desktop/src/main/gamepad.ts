import { app, powerMonitor } from "electron";

import {
  type GamepadTracker,
  type PadState,
  createGamepadTracker,
} from "./gamepadLogic";

/** Number of controller slots XInput has. */
const SLOTS = 4;

/** Poll interval for connected pads (about 60 Hz). */
const POLL_MS = 16;

/** How often an empty slot is checked, the call is slow for those. */
const PROBE_MS = 1000;

/** Reads a slot into `out`, returns 0 when a pad is connected. */
type GetState = (slot: number, out: Record<string, unknown>) => number;

/** Loaded XInput function, `null` once loading failed, `undefined` before. */
let getState: GetState | null | undefined;

/** Callback for press (true) and release (false). */
let currentEmit: (down: boolean) => void = () => {};

/** Edge detector, created together with the XInput binding. */
let tracker: GamepadTracker | undefined;

/** Polling timer, set while a button is configured. */
let timer: NodeJS.Timeout | undefined;

/** Per slot: whether a pad answered last time. */
const connected: boolean[] = Array(SLOTS).fill(false);

/** Per slot: when an empty slot may be probed again. */
const nextProbe: number[] = Array(SLOTS).fill(0);

/** Whether the quit and power listeners were registered. */
let hooked = false;

/**
 * Load XInput through koffi on first use. Windows only. A missing DLL or
 * module must not stop the app, push-to-talk is just unavailable then.
 *
 * @returns The `XInputGetState` wrapper, or null if unavailable
 */
function load(): GetState | null {
  if (getState !== undefined) return getState;
  getState = null;
  if (process.platform !== "win32") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require("koffi");
    const Gamepad = koffi.struct("XINPUT_GAMEPAD", {
      wButtons: "uint16",
      bLeftTrigger: "uint8",
      bRightTrigger: "uint8",
      sThumbLX: "int16",
      sThumbLY: "int16",
      sThumbRX: "int16",
      sThumbRY: "int16",
    });
    koffi.struct("XINPUT_STATE", {
      dwPacketNumber: "uint32",
      Gamepad,
    });
    let lib;
    try {
      lib = koffi.load("xinput1_4.dll");
    } catch {
      lib = koffi.load("xinput9_1_0.dll");
    }
    const fn = lib.func(
      "uint32 __stdcall XInputGetState(uint32 user, _Out_ XINPUT_STATE *state)",
    );
    getState = (slot, out) => fn(slot, out);
    tracker = createGamepadTracker((down) => currentEmit(down));
  } catch (error) {
    console.warn("[gamepad] XInput unavailable:", error);
    getState = null;
  }
  return getState;
}

/**
 * Whether controller push-to-talk can work here.
 *
 * @returns True on Windows when XInput loaded
 */
export function gamepadSupported(): boolean {
  return load() !== null;
}

/** Read every slot once and feed the tracker. */
function poll(read: GetState) {
  const now = Date.now();
  const pads: (PadState | null)[] = [];
  for (let slot = 0; slot < SLOTS; slot++) {
    if (!connected[slot] && now < nextProbe[slot]) {
      pads.push(null);
      continue;
    }
    const out: Record<string, unknown> = {};
    let ok = false;
    try {
      ok = read(slot, out) === 0;
    } catch {
      ok = false;
    }
    connected[slot] = ok;
    if (!ok) nextProbe[slot] = now + PROBE_MS;
    const gp = out.Gamepad as
      | { wButtons: number; bLeftTrigger: number; bRightTrigger: number }
      | undefined;
    pads.push(
      ok && gp
        ? {
            buttons: gp.wButtons,
            leftTrigger: gp.bLeftTrigger,
            rightTrigger: gp.bRightTrigger,
          }
        : null,
    );
  }
  tracker?.update(pads);
}

/** Stop polling and release the button if held. */
export function stopGamepad() {
  if (timer) clearInterval(timer);
  timer = undefined;
  tracker?.setButton(null);
  connected.fill(false);
  nextProbe.fill(0);
}

/**
 * Choose the controller button that acts as push-to-talk. Polls only while a
 * button is configured.
 *
 * @param button Button name, or null to turn it off
 * @param emit Called with true on press and false on release
 * @returns True if polling is active
 */
export function setGamepadPushToTalk(
  button: string | null,
  emit: (down: boolean) => void,
): boolean {
  const read = load();
  currentEmit = emit;
  if (!read || !tracker) return false;

  if (!hooked) {
    hooked = true;
    app.on("will-quit", stopGamepad);
    // A release is lost while locked or asleep, so drop the held state
    const release = () => tracker?.release();
    powerMonitor.on("lock-screen", release);
    powerMonitor.on("suspend", release);
  }

  if (!tracker.setButton(button) || button === null) {
    stopGamepad();
    return false;
  }
  if (!timer) {
    timer = setInterval(() => poll(read), POLL_MS);
    timer.unref();
  }
  return true;
}
