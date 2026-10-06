/**
 * Reading game controllers: turning the raw Gamepad API state into presses,
 * moves and scrolling. It has no DOM or timers of its own (the caller passes
 * the time), so it can be tested directly.
 *
 * Buttons are named by position on the standard layout (A is the bottom
 * button, B the right one), so the same names fit Xbox, PlayStation, Switch
 * and Steam Deck controllers.
 */
import type { Direction } from "./spatial";

/** Face and shoulder buttons that act once per press */
export type PressButton =
  | "a"
  | "b"
  | "x"
  | "y"
  | "lb"
  | "rb"
  | "lt"
  | "rt"
  | "select"
  | "start";

/** What a controller did during one poll */
export type InputEvent =
  | { kind: "move"; direction: Direction }
  | { kind: "press"; button: PressButton }
  | { kind: "scroll"; amount: number };

/** The parts of a Gamepad this module reads, so tests can fake it */
export interface PadLike {
  mapping: string;
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  axes: ReadonlyArray<number>;
}

/** Controller state after mapping, the same for every controller */
export interface PadSnapshot {
  /** Whether the controller reports the standard layout */
  standard: boolean;
  /** Buttons that are held */
  pressed: Record<PressButton, boolean>;
  /** D-pad directions that are held */
  dpad: Record<Direction, boolean>;
  /** Left stick, -1 to 1, y grows downwards */
  left: { x: number; y: number };
  /** Right stick, -1 to 1, y grows downwards */
  right: { x: number; y: number };
}

/** How far a stick has to tip before it counts as a direction */
export const STICK_DEADZONE = 0.5;

/** How far the scroll stick has to tip before it scrolls */
export const SCROLL_DEADZONE = 0.2;

/** Analogue trigger value that counts as pressed when `pressed` isn't set */
export const TRIGGER_THRESHOLD = 0.5;

/** Time a held direction waits before it starts repeating, in milliseconds */
export const REPEAT_DELAY_MS = 400;

/** Time between repeats of a held direction, in milliseconds */
export const REPEAT_INTERVAL_MS = 100;

/** Scroll speed at full stick, in pixels per millisecond */
export const SCROLL_SPEED = 1.2;

/** Longest frame time used for scrolling, so a pause doesn't cause a jump */
export const MAX_FRAME_MS = 50;

/** Button index on the standard layout for each button */
const STANDARD_BUTTONS: Record<PressButton, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  select: 8,
  start: 9,
};

/** D-pad button index on the standard layout for each direction */
const STANDARD_DPAD: Record<Direction, number> = {
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};

/** All buttons that act once per press */
export const PRESS_BUTTONS = Object.keys(STANDARD_BUTTONS) as PressButton[];

/** All directions */
export const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

/**
 * Whether a button is held
 * @param pad Controller
 * @param index Button index
 * @returns Boolean
 */
function isHeld(pad: PadLike, index: number): boolean {
  const button = pad.buttons[index];
  return !!button && (button.pressed || button.value > TRIGGER_THRESHOLD);
}

/**
 * An axis value, 0 when the controller doesn't have it or it's not a number
 * @param pad Controller
 * @param index Axis index
 * @returns Value from -1 to 1
 */
function axis(pad: PadLike, index: number): number {
  const value = pad.axes[index];
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/**
 * Whether a device is a controller worth reading: the standard layout, or at
 * least the four face buttons
 * @param pad Controller
 * @returns Boolean
 */
export function isUsablePad(pad: PadLike): boolean {
  return pad.mapping === "standard" || pad.buttons.length >= 4;
}

/**
 * Read a controller into the same shape whatever its layout. With the
 * standard layout every button and stick is used. Controllers without it
 * (reported with an empty mapping) only give buttons 0 to 3 and the first two
 * axes, which is all that can be trusted there; the stick then stands in for
 * the D-pad.
 * @param pad Controller
 * @returns Snapshot
 */
export function snapshotPad(pad: PadLike): PadSnapshot {
  const standard = pad.mapping === "standard";

  // throttles, motion sensors and mice sometimes show up as controllers
  if (!isUsablePad(pad)) {
    return {
      standard: false,
      pressed: Object.fromEntries(
        PRESS_BUTTONS.map((button) => [button, false]),
      ) as Record<PressButton, boolean>,
      dpad: { up: false, down: false, left: false, right: false },
      left: { x: 0, y: 0 },
      right: { x: 0, y: 0 },
    };
  }

  const pressed = {} as Record<PressButton, boolean>;
  for (const button of PRESS_BUTTONS) {
    const index = STANDARD_BUTTONS[button];
    pressed[button] = (standard || index <= 3) && isHeld(pad, index);
  }

  const dpad = {} as Record<Direction, boolean>;
  for (const direction of DIRECTIONS) {
    dpad[direction] = standard && isHeld(pad, STANDARD_DPAD[direction]);
  }

  return {
    standard,
    pressed,
    dpad,
    left: { x: axis(pad, 0), y: axis(pad, 1) },
    right: standard ? { x: axis(pad, 2), y: axis(pad, 3) } : { x: 0, y: 0 },
  };
}

/**
 * Directions held by the D-pad and the left stick. The stick gives one
 * direction at most (the one it is tipped furthest towards), so a diagonal
 * doesn't move twice.
 * @param snapshot Controller state
 * @param deadzone How far the stick has to tip
 * @returns Which directions are held
 */
export function heldDirections(
  snapshot: PadSnapshot,
  deadzone = STICK_DEADZONE,
): Record<Direction, boolean> {
  const held: Record<Direction, boolean> = { ...snapshot.dpad };

  const { x, y } = snapshot.left;
  if (Math.max(Math.abs(x), Math.abs(y)) > deadzone) {
    if (Math.abs(x) > Math.abs(y)) {
      held[x < 0 ? "left" : "right"] = true;
    } else {
      held[y < 0 ? "up" : "down"] = true;
    }
  }

  return held;
}

/**
 * Pixels to scroll for a stick position, 0 inside the dead zone. Speed grows
 * with how far the stick is tipped, starting from zero at the dead zone's edge.
 * @param value Stick value from -1 to 1 (negative scrolls up)
 * @param elapsed Time since the last poll, in milliseconds
 * @returns Pixels to scroll, negative for up
 */
export function scrollAmount(value: number, elapsed: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= SCROLL_DEADZONE) return 0;

  const strength = Math.min(
    1,
    (magnitude - SCROLL_DEADZONE) / (1 - SCROLL_DEADZONE),
  );
  const frame = Math.max(0, Math.min(elapsed, MAX_FRAME_MS));
  return Math.sign(value) * strength * strength * SCROLL_SPEED * frame;
}

/**
 * Fires once when something is first held, then again after a delay and at a
 * steady interval for as long as it stays held (like keyboard key repeat)
 */
export class KeyRepeater {
  private nextAt: number | null = null;

  /**
   * @param delay Wait before the first repeat, in milliseconds
   * @param interval Time between repeats, in milliseconds
   */
  constructor(
    private readonly delay = REPEAT_DELAY_MS,
    private readonly interval = REPEAT_INTERVAL_MS,
  ) {}

  /**
   * Feed the current state
   * @param held Whether it is held right now
   * @param now Current time in milliseconds
   * @returns Whether to act now
   */
  update(held: boolean, now: number): boolean {
    if (!held) {
      this.nextAt = null;
      return false;
    }

    if (this.nextAt === null) {
      this.nextAt = now + this.delay;
      return true;
    }

    if (now >= this.nextAt) {
      this.nextAt = now + this.interval;
      return true;
    }

    return false;
  }
}

/**
 * Follows one controller between polls and turns its state into events:
 * single presses for buttons, repeating moves for the D-pad and left stick,
 * and scrolling for the right stick.
 *
 * Whatever is held when the first poll happens (a button that was used to wake
 * the controller up) is ignored until it has been released, so connecting a
 * controller never triggers an action.
 */
export class PadTracker {
  private readonly previous = new Set<PressButton>();
  private readonly repeaters: Record<Direction, KeyRepeater> = {
    up: new KeyRepeater(),
    down: new KeyRepeater(),
    left: new KeyRepeater(),
    right: new KeyRepeater(),
  };
  private ignored = new Set<string>();
  private primed = false;
  private lastTime: number | null = null;

  /**
   * Poll the controller
   * @param snapshot Controller state
   * @param now Current time in milliseconds
   * @returns Events since the last poll
   */
  poll(snapshot: PadSnapshot, now: number): InputEvent[] {
    const directions = heldDirections(snapshot);

    if (!this.primed) {
      this.primed = true;
      for (const button of PRESS_BUTTONS) {
        if (snapshot.pressed[button]) this.ignored.add(button);
      }
      for (const direction of DIRECTIONS) {
        if (directions[direction]) this.ignored.add(direction);
      }
      if (Math.abs(snapshot.right.y) > SCROLL_DEADZONE) {
        this.ignored.add("scroll");
      }
    }

    const elapsed = this.lastTime === null ? 0 : now - this.lastTime;
    this.lastTime = now;

    const events: InputEvent[] = [];

    // a held input stays masked until it was seen released once
    const held = (key: string, value: boolean) => {
      if (this.ignored.has(key)) {
        if (value) return false;
        this.ignored.delete(key);
      }
      return value;
    };

    for (const direction of DIRECTIONS) {
      if (
        this.repeaters[direction].update(
          held(direction, directions[direction]),
          now,
        )
      ) {
        events.push({ kind: "move", direction });
      }
    }

    for (const button of PRESS_BUTTONS) {
      const down = held(button, snapshot.pressed[button]);
      if (down && !this.previous.has(button)) {
        events.push({ kind: "press", button });
      }
      if (down) this.previous.add(button);
      else this.previous.delete(button);
    }

    const scrolling = held(
      "scroll",
      Math.abs(snapshot.right.y) > SCROLL_DEADZONE,
    );
    if (scrolling) {
      const amount = scrollAmount(snapshot.right.y, elapsed);
      if (amount !== 0) events.push({ kind: "scroll", amount });
    }

    return events;
  }
}
