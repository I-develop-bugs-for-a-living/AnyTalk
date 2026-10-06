import { describe, expect, it } from "vitest";

import {
  KeyRepeater,
  PadLike,
  PadTracker,
  REPEAT_DELAY_MS,
  REPEAT_INTERVAL_MS,
  SCROLL_DEADZONE,
  heldDirections,
  isUsablePad,
  scrollAmount,
  snapshotPad,
} from "./input";

/** Build a fake standard controller with the given buttons and axes held */
function pad(
  held: number[] = [],
  axes: number[] = [0, 0, 0, 0],
  mapping = "standard",
): PadLike {
  return {
    mapping,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: held.includes(i),
      value: held.includes(i) ? 1 : 0,
    })),
  };
}

describe("snapshotPad", () => {
  it("maps the standard layout by position", () => {
    const snapshot = snapshotPad(pad([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(snapshot.standard).toBe(true);
    expect(Object.values(snapshot.pressed).every(Boolean)).toBe(true);
    expect(snapshot.dpad).toEqual({
      up: false,
      down: false,
      left: false,
      right: false,
    });
  });

  it("reads the D-pad", () => {
    const snapshot = snapshotPad(pad([12, 15]));
    expect(snapshot.dpad).toEqual({
      up: true,
      down: false,
      left: false,
      right: true,
    });
  });

  it("counts an analogue trigger past the threshold as pressed", () => {
    const trigger: PadLike = {
      ...pad(),
      buttons: pad().buttons.map((b, i) =>
        i === 7 ? { pressed: false, value: 0.8 } : b,
      ),
    };
    expect(snapshotPad(trigger).pressed.rt).toBe(true);
    expect(snapshotPad(pad()).pressed.rt).toBe(false);
  });

  it("reads both sticks and clamps and cleans values", () => {
    const snapshot = snapshotPad(pad([], [-0.5, 2, NaN, 0.25]));
    expect(snapshot.left).toEqual({ x: -0.5, y: 1 });
    expect(snapshot.right).toEqual({ x: 0, y: 0.25 });
  });

  it("only trusts buttons 0 to 3 and axes 0 and 1 without the standard layout", () => {
    const snapshot = snapshotPad(
      pad([0, 1, 4, 9, 12], [0.9, -0.9, 0.9, 0.9], ""),
    );
    expect(snapshot.standard).toBe(false);
    expect(snapshot.pressed.a).toBe(true);
    expect(snapshot.pressed.b).toBe(true);
    expect(snapshot.pressed.lb).toBe(false);
    expect(snapshot.pressed.start).toBe(false);
    expect(snapshot.dpad.up).toBe(false);
    expect(snapshot.left).toEqual({ x: 0.9, y: -0.9 });
    expect(snapshot.right).toEqual({ x: 0, y: 0 });
  });

  it("copes with a controller that has few buttons and axes", () => {
    const snapshot = snapshotPad({
      mapping: "",
      buttons: [
        { pressed: true, value: 1 },
        ...Array.from({ length: 3 }, () => ({ pressed: false, value: 0 })),
      ],
      axes: [],
    });
    expect(snapshot.pressed.a).toBe(true);
    expect(snapshot.pressed.b).toBe(false);
    expect(snapshot.left).toEqual({ x: 0, y: 0 });
  });
});

describe("heldDirections", () => {
  const none = { up: false, down: false, left: false, right: false };

  it("returns nothing for a centred controller", () => {
    expect(heldDirections(snapshotPad(pad()))).toEqual(none);
  });

  it("uses the D-pad", () => {
    expect(heldDirections(snapshotPad(pad([13])))).toEqual({
      ...none,
      down: true,
    });
  });

  it("ignores a stick inside the dead zone", () => {
    expect(heldDirections(snapshotPad(pad([], [0.5, -0.4])))).toEqual(none);
  });

  it("reads a stick past the dead zone", () => {
    expect(heldDirections(snapshotPad(pad([], [0.9, 0.1])))).toEqual({
      ...none,
      right: true,
    });
    expect(heldDirections(snapshotPad(pad([], [-0.1, -0.9])))).toEqual({
      ...none,
      up: true,
    });
  });

  it("picks the dominant axis on a diagonal", () => {
    expect(heldDirections(snapshotPad(pad([], [0.6, 0.9])))).toEqual({
      ...none,
      down: true,
    });
    expect(heldDirections(snapshotPad(pad([], [-0.9, 0.6])))).toEqual({
      ...none,
      left: true,
    });
  });
});

describe("scrollAmount", () => {
  it("is zero inside the dead zone", () => {
    expect(scrollAmount(0, 16)).toBe(0);
    expect(scrollAmount(SCROLL_DEADZONE, 16)).toBe(0);
    expect(scrollAmount(-SCROLL_DEADZONE, 16)).toBe(0);
  });

  it("scrolls in the direction of the stick", () => {
    expect(scrollAmount(1, 16)).toBeGreaterThan(0);
    expect(scrollAmount(-1, 16)).toBeLessThan(0);
    expect(scrollAmount(-1, 16)).toBe(-scrollAmount(1, 16));
  });

  it("grows with the stick position and the frame time", () => {
    expect(scrollAmount(1, 16)).toBeGreaterThan(scrollAmount(0.6, 16));
    expect(scrollAmount(1, 32)).toBeGreaterThan(scrollAmount(1, 16));
  });

  it("caps the frame time and ignores negative time", () => {
    expect(scrollAmount(1, 5000)).toBe(scrollAmount(1, 50));
    expect(scrollAmount(1, -10)).toBe(0);
  });
});

describe("KeyRepeater", () => {
  it("fires on the first press, waits, then repeats", () => {
    const repeater = new KeyRepeater();
    expect(repeater.update(true, 0)).toBe(true);
    expect(repeater.update(true, REPEAT_DELAY_MS - 1)).toBe(false);
    expect(repeater.update(true, REPEAT_DELAY_MS)).toBe(true);
    expect(
      repeater.update(true, REPEAT_DELAY_MS + REPEAT_INTERVAL_MS - 1),
    ).toBe(false);
    expect(repeater.update(true, REPEAT_DELAY_MS + REPEAT_INTERVAL_MS)).toBe(
      true,
    );
  });

  it("does not burst after a long pause", () => {
    const repeater = new KeyRepeater();
    repeater.update(true, 0);
    expect(repeater.update(true, 5000)).toBe(true);
    expect(repeater.update(true, 5001)).toBe(false);
  });

  it("starts over after release", () => {
    const repeater = new KeyRepeater();
    repeater.update(true, 0);
    expect(repeater.update(false, 100)).toBe(false);
    expect(repeater.update(true, 200)).toBe(true);
    expect(repeater.update(true, 200 + REPEAT_DELAY_MS - 1)).toBe(false);
  });

  it("never fires while released", () => {
    const repeater = new KeyRepeater();
    expect(repeater.update(false, 0)).toBe(false);
    expect(repeater.update(false, 10_000)).toBe(false);
  });
});

describe("PadTracker", () => {
  it("emits one press per button push", () => {
    const tracker = new PadTracker();
    expect(tracker.poll(snapshotPad(pad()), 0)).toEqual([]);
    expect(tracker.poll(snapshotPad(pad([0])), 16)).toEqual([
      { kind: "press", button: "a" },
    ]);
    // still held: no second press
    expect(tracker.poll(snapshotPad(pad([0])), 32)).toEqual([]);
    expect(tracker.poll(snapshotPad(pad()), 48)).toEqual([]);
    expect(tracker.poll(snapshotPad(pad([0])), 64)).toEqual([
      { kind: "press", button: "a" },
    ]);
  });

  it("emits several simultaneous presses", () => {
    const tracker = new PadTracker();
    tracker.poll(snapshotPad(pad()), 0);
    const events = tracker.poll(snapshotPad(pad([4, 6])), 16);
    expect(events).toContainEqual({ kind: "press", button: "lb" });
    expect(events).toContainEqual({ kind: "press", button: "lt" });
    expect(events).toHaveLength(2);
  });

  it("repeats a held D-pad direction with a delay", () => {
    const tracker = new PadTracker();
    tracker.poll(snapshotPad(pad()), 0);
    const down = snapshotPad(pad([13]));
    expect(tracker.poll(down, 10)).toEqual([
      { kind: "move", direction: "down" },
    ]);
    expect(tracker.poll(down, 200)).toEqual([]);
    expect(tracker.poll(down, 10 + REPEAT_DELAY_MS)).toEqual([
      { kind: "move", direction: "down" },
    ]);
  });

  it("moves with the left stick and stops at the dead zone", () => {
    const tracker = new PadTracker();
    tracker.poll(snapshotPad(pad()), 0);
    expect(tracker.poll(snapshotPad(pad([], [0, -1])), 10)).toEqual([
      { kind: "move", direction: "up" },
    ]);
    expect(tracker.poll(snapshotPad(pad([], [0, -0.2])), 20)).toEqual([]);
  });

  it("scrolls with the right stick only", () => {
    const tracker = new PadTracker();
    tracker.poll(snapshotPad(pad()), 0);
    const events = tracker.poll(snapshotPad(pad([], [0, 0, 0, 1])), 16);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("scroll");
    expect(
      (events[0] as { kind: "scroll"; amount: number }).amount,
    ).toBeGreaterThan(0);
    expect(tracker.poll(snapshotPad(pad([], [0, 0, 0, 0.1])), 32)).toEqual([]);
  });

  it("ignores what is held on the first poll until it is released", () => {
    const tracker = new PadTracker();
    // controller wakes up with A and the D-pad already held
    expect(tracker.poll(snapshotPad(pad([0, 13])), 0)).toEqual([]);
    expect(tracker.poll(snapshotPad(pad([0, 13])), 500)).toEqual([]);
    expect(tracker.poll(snapshotPad(pad()), 516)).toEqual([]);
    expect(tracker.poll(snapshotPad(pad([0])), 532)).toEqual([
      { kind: "press", button: "a" },
    ]);
  });

  it("works with a controller without the standard layout", () => {
    const tracker = new PadTracker();
    const fake = (held: number[], axes: number[]) =>
      snapshotPad(pad(held, axes, ""));
    tracker.poll(fake([], [0, 0]), 0);
    expect(tracker.poll(fake([1, 5], [1, 0]), 16)).toEqual([
      { kind: "move", direction: "right" },
      { kind: "press", button: "b" },
    ]);
  });
});

describe("non-standard devices", () => {
  it("ignores devices with fewer than four buttons and no standard mapping", () => {
    const throttle = {
      mapping: "",
      buttons: [{ pressed: true, value: 1 }],
      axes: [1, 1],
    };
    expect(isUsablePad(throttle)).toBe(false);
    const snapshot = snapshotPad(throttle);
    expect(Object.values(snapshot.pressed).some(Boolean)).toBe(false);
    expect(snapshot.left).toEqual({ x: 0, y: 0 });
  });

  it("keeps standard pads and pads with four buttons", () => {
    expect(isUsablePad({ mapping: "standard", buttons: [], axes: [] })).toBe(
      true,
    );
    const four = Array.from({ length: 4 }, () => ({
      pressed: false,
      value: 0,
    }));
    expect(isUsablePad({ mapping: "", buttons: four, axes: [] })).toBe(true);
  });
});
