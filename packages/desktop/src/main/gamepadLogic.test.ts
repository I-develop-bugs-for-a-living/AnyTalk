import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type PadState,
  buttonSpec,
  createGamepadTracker,
} from "./gamepadLogic.ts";

/** A pad with nothing pressed, plus overrides. */
const pad = (over: Partial<PadState> = {}): PadState => ({
  buttons: 0,
  leftTrigger: 0,
  rightTrigger: 0,
  ...over,
});

/** Tracker plus the emitted events. */
function setup(button: string | null) {
  const events: boolean[] = [];
  const tracker = createGamepadTracker((down) => events.push(down));
  assert.equal(tracker.setButton(button), true);
  return { events, tracker };
}

describe("buttonSpec", () => {
  it("maps names to XInput bits", () => {
    assert.deepEqual(buttonSpec("a"), { kind: "mask", mask: 0x1000 });
    assert.deepEqual(buttonSpec("select"), { kind: "mask", mask: 0x0020 });
    assert.deepEqual(buttonSpec("l3"), { kind: "mask", mask: 0x0040 });
    assert.deepEqual(buttonSpec("right"), { kind: "mask", mask: 0x0008 });
    assert.deepEqual(buttonSpec("lt"), { kind: "trigger", side: "left" });
    assert.deepEqual(buttonSpec("rt"), { kind: "trigger", side: "right" });
  });

  it("rejects unknown names", () => {
    assert.equal(buttonSpec("nope"), null);
    assert.equal(buttonSpec("toString"), null);
    assert.equal(buttonSpec(3), null);
  });
});

describe("gamepad tracker", () => {
  it("emits down once and up on release", () => {
    const { events, tracker } = setup("a");
    tracker.update([pad({ buttons: 0x1000 })]);
    tracker.update([pad({ buttons: 0x1000 })]);
    assert.deepEqual(events, [true]);
    tracker.update([pad()]);
    assert.deepEqual(events, [true, false]);
  });

  it("is held while any pad holds it", () => {
    const { events, tracker } = setup("a");
    tracker.update([pad({ buttons: 0x1000 }), pad({ buttons: 0x1000 })]);
    tracker.update([pad(), pad({ buttons: 0x1000 })]);
    assert.deepEqual(events, [true]);
    tracker.update([pad(), pad()]);
    assert.deepEqual(events, [true, false]);
  });

  it("releases when the pad disconnects", () => {
    const { events, tracker } = setup("b");
    tracker.update([pad({ buttons: 0x2000 })]);
    tracker.update([null]);
    assert.deepEqual(events, [true, false]);
  });

  it("applies hysteresis to triggers", () => {
    const { events, tracker } = setup("lt");
    tracker.update([pad({ leftTrigger: 25 })]);
    assert.deepEqual(events, []);
    tracker.update([pad({ leftTrigger: 35 })]);
    tracker.update([pad({ leftTrigger: 25 })]);
    assert.deepEqual(events, [true]);
    tracker.update([pad({ leftTrigger: 15 })]);
    assert.deepEqual(events, [true, false]);
  });

  it("releases on button change, clearing and release()", () => {
    const { events, tracker } = setup("a");
    tracker.update([pad({ buttons: 0x1000 })]);
    tracker.setButton("b");
    assert.deepEqual(events, [true, false]);
    tracker.update([pad({ buttons: 0x2000 })]);
    tracker.setButton(null);
    assert.deepEqual(events, [true, false, true, false]);
    tracker.setButton("a");
    tracker.update([pad({ buttons: 0x1000 })]);
    tracker.release();
    assert.deepEqual(events.slice(-2), [true, false]);
  });

  it("watches nothing for an unknown name", () => {
    const events: boolean[] = [];
    const tracker = createGamepadTracker((d) => events.push(d));
    assert.equal(tracker.setButton("nope"), false);
    tracker.update([pad({ buttons: 0xffff })]);
    assert.deepEqual(events, []);
  });
});
