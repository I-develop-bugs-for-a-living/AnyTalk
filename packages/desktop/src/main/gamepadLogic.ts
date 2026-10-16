/**
 * Pure logic for the controller push-to-talk: button names, trigger
 * hysteresis and edge detection across pads. It imports nothing, so
 * `node --test` can run it.
 */

/** Button names the client may send. */
export const GAMEPAD_BUTTONS = [
  "a",
  "b",
  "x",
  "y",
  "lb",
  "rb",
  "lt",
  "rt",
  "select",
  "start",
  "l3",
  "r3",
  "up",
  "down",
  "left",
  "right",
] as const;

/** A button name, see `GAMEPAD_BUTTONS`. */
export type GamepadButton = (typeof GAMEPAD_BUTTONS)[number];

/** XInput `wButtons` bit of each digital button. */
const MASKS: Record<string, number> = {
  up: 0x0001,
  down: 0x0002,
  left: 0x0004,
  right: 0x0008,
  start: 0x0010,
  select: 0x0020,
  l3: 0x0040,
  r3: 0x0080,
  lb: 0x0100,
  rb: 0x0200,
  a: 0x1000,
  b: 0x2000,
  x: 0x4000,
  y: 0x8000,
};

/** Trigger value (0-255) from which a trigger counts as pressed. */
export const TRIGGER_PRESS = 30;

/** Trigger value below which a pressed trigger counts as released. */
export const TRIGGER_RELEASE = 20;

/** What to look at on a pad: a bit of `wButtons`, or a trigger. */
export type ButtonSpec =
  | { kind: "mask"; mask: number }
  | { kind: "trigger"; side: "left" | "right" };

/** One pad's state as read from `XInputGetState`. */
export type PadState = {
  buttons: number;
  leftTrigger: number;
  rightTrigger: number;
};

/**
 * Look up a button name.
 *
 * @param name Name from the client
 * @returns How to read the button, or null for an unknown name
 */
export function buttonSpec(name: unknown): ButtonSpec | null {
  if (name === "lt") return { kind: "trigger", side: "left" };
  if (name === "rt") return { kind: "trigger", side: "right" };
  if (typeof name === "string" && Object.hasOwn(MASKS, name))
    return { kind: "mask", mask: MASKS[name] };
  return null;
}

/**
 * Whether the button is pressed on a pad. Triggers use hysteresis so a value
 * hovering near the threshold doesn't chatter.
 *
 * @param spec Button to read
 * @param pad Pad state
 * @param wasPressed Whether it counted as pressed on the previous read
 */
export function isPressed(
  spec: ButtonSpec,
  pad: PadState,
  wasPressed: boolean,
): boolean {
  if (spec.kind === "mask") return (pad.buttons & spec.mask) !== 0;
  const value = spec.side === "left" ? pad.leftTrigger : pad.rightTrigger;
  return wasPressed ? value >= TRIGGER_RELEASE : value >= TRIGGER_PRESS;
}

/** Tracker fed with pad states, see `createGamepadTracker`. */
export type GamepadTracker = {
  /**
   * Choose the button to watch. Emits `up` first if the old one was held.
   * @returns False (and watches nothing) for an unknown name
   */
  setButton(name: string | null): boolean;
  /**
   * Feed the latest state of every slot, `null` for a disconnected one.
   * The button counts as held while it is held on any pad.
   */
  update(pads: (PadState | null)[]): void;
  /** Emit `up` if held and forget pad states. */
  release(): void;
};

/**
 * Create the edge detector for the push-to-talk button.
 *
 * @param emit Called with true on press and false on release
 */
export function createGamepadTracker(
  emit: (down: boolean) => void,
): GamepadTracker {
  let spec: ButtonSpec | null = null;
  let held = false;
  /** Per slot: whether the button counted as pressed last time */
  let perPad: boolean[] = [];

  /** Emit when the overall state changed. */
  const set = (next: boolean) => {
    if (next === held) return;
    held = next;
    emit(next);
  };

  return {
    setButton(name) {
      set(false);
      perPad = [];
      spec = name === null ? null : buttonSpec(name);
      return name === null || spec !== null;
    },
    update(pads) {
      if (!spec) return;
      const current = spec;
      perPad = pads.map((pad, i) =>
        pad ? isPressed(current, pad, perPad[i] ?? false) : false,
      );
      set(perPad.some(Boolean));
    },
    release() {
      perPad = [];
      set(false);
    },
  };
}
