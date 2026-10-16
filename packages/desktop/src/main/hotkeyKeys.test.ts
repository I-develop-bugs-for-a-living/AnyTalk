import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type HotkeyEdge,
  type ModifierSet,
  createHotkeyMatcher,
  parseAccelerator,
} from "./hotkeyKeys.ts";

/** Small stand-in for `UiohookKey`. */
const KEYS = {
  Ctrl: 29,
  CtrlRight: 3613,
  Alt: 56,
  AltRight: 3640,
  Shift: 42,
  ShiftRight: 54,
  Meta: 3675,
  MetaRight: 3676,
  M: 50,
  Z: 44,
  Y: 21,
  Enter: 28,
  NumpadEnter: 3612,
  F5: 63,
  Space: 57,
  Equal: 13,
  Numpad1: 79,
  NumpadAdd: 78,
  ArrowUp: 57416,
  PageDown: 3665,
  Backquote: 41,
  Minus: 12,
  5: 6,
  1: 2,
};

/** Physical modifier keycodes and the flag each one sets. */
const MOD_FLAG: Record<number, keyof ModifierSet> = {
  29: "ctrl",
  3613: "ctrl",
  56: "alt",
  3640: "alt",
  42: "shift",
  54: "shift",
  3675: "meta",
  3676: "meta",
};

/**
 * Matcher plus the emitted events. Like the real hook, every event carries
 * the modifier flags as they are after the event.
 */
function setup(...bindings: (string | [string, string])[]) {
  const events: string[] = [];
  const matcher = createHotkeyMatcher((action, edge: HotkeyEdge) =>
    events.push(`${action}:${edge}`),
  );
  matcher.setBindings(
    bindings.map((b) => {
      const [accelerator, code] = typeof b === "string" ? [b, undefined] : b;
      const parsed = parseAccelerator(accelerator, KEYS, code);
      assert.ok(parsed, accelerator);
      return { action: accelerator, parsed };
    }),
  );
  const mods: ModifierSet = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };
  return {
    events,
    matcher,
    mods,
    down(keycode: number) {
      if (MOD_FLAG[keycode]) mods[MOD_FLAG[keycode]] = true;
      matcher.keyDown(keycode, { ...mods });
    },
    up(keycode: number) {
      if (MOD_FLAG[keycode]) mods[MOD_FLAG[keycode]] = false;
      matcher.keyUp(keycode, { ...mods });
    },
  };
}

describe("parseAccelerator", () => {
  it("parses modifiers and main key", () => {
    assert.deepEqual(parseAccelerator("Ctrl+Shift+M", KEYS), {
      modifiers: { ctrl: true, alt: false, shift: true, meta: false },
      keycodes: [50],
    });
  });

  it("parses the special key names", () => {
    assert.deepEqual(parseAccelerator("F5", KEYS)?.keycodes, [63]);
    assert.deepEqual(parseAccelerator("Plus", KEYS)?.keycodes, [13]);
    assert.deepEqual(parseAccelerator("num1", KEYS)?.keycodes, [79]);
    assert.deepEqual(parseAccelerator("numadd", KEYS)?.keycodes, [78]);
    assert.deepEqual(parseAccelerator("Up", KEYS)?.keycodes, [57416]);
    assert.deepEqual(parseAccelerator("PageDown", KEYS)?.keycodes, [3665]);
    assert.deepEqual(parseAccelerator("`", KEYS)?.keycodes, [41]);
    assert.equal(parseAccelerator("Super+5", KEYS)?.modifiers.meta, true);
  });

  it("rejects unknown input", () => {
    assert.equal(parseAccelerator("", KEYS), null);
    assert.equal(parseAccelerator("Hyper+M", KEYS), null);
    assert.equal(parseAccelerator("Ctrl+Nope", KEYS), null);
    assert.equal(parseAccelerator("Ctrl+F24", KEYS), null);
  });

  it("matches plain Enter on both Enter keys", () => {
    assert.deepEqual(parseAccelerator("Enter", KEYS)?.keycodes, [28, 3612]);
    assert.deepEqual(
      parseAccelerator("Enter", KEYS, "NumpadEnter")?.keycodes,
      [3612],
    );
  });

  it("prefers the physical key code over the layout's letter", () => {
    // QWERTZ: the key labelled Z sits where US has Y
    assert.deepEqual(parseAccelerator("Ctrl+Z", KEYS, "KeyY")?.keycodes, [21]);
    assert.deepEqual(parseAccelerator("1", KEYS, "Digit1")?.keycodes, [2]);
    assert.deepEqual(parseAccelerator("-", KEYS, "Minus")?.keycodes, [12]);
    assert.equal(
      parseAccelerator("Ctrl+Z", KEYS, "KeyY")?.modifiers.ctrl,
      true,
    );
  });

  it("falls back to the accelerator for an unknown code", () => {
    assert.deepEqual(parseAccelerator("M", KEYS, "Bogus")?.keycodes, [50]);
  });
});

describe("hotkey matcher", () => {
  it("fires down once and ignores auto-repeat, then up", () => {
    const t = setup("Ctrl+M");
    t.down(KEYS.Ctrl);
    t.down(KEYS.M);
    t.down(KEYS.M);
    t.down(KEYS.M);
    assert.deepEqual(t.events, ["Ctrl+M:down"]);
    t.up(KEYS.M);
    assert.deepEqual(t.events, ["Ctrl+M:down", "Ctrl+M:up"]);
  });

  it("accepts the right-hand modifier", () => {
    const t = setup("Ctrl+M");
    t.down(KEYS.CtrlRight);
    t.down(KEYS.M);
    assert.deepEqual(t.events, ["Ctrl+M:down"]);
  });

  it("needs the exact modifiers", () => {
    const t = setup("Ctrl+M", "M");
    t.down(KEYS.Ctrl);
    t.down(KEYS.Shift);
    t.down(KEYS.M);
    assert.deepEqual(t.events, []);
    t.up(KEYS.M);
    t.up(KEYS.Shift);
    t.down(KEYS.M);
    assert.deepEqual(t.events, ["Ctrl+M:down"]);
  });

  it("releases when a required modifier goes up first", () => {
    const t = setup("Ctrl+M");
    t.down(KEYS.Ctrl);
    t.down(KEYS.M);
    t.up(KEYS.Ctrl);
    assert.deepEqual(t.events, ["Ctrl+M:down", "Ctrl+M:up"]);
    // The later main key release must not emit a second up
    t.up(KEYS.M);
    assert.equal(t.events.length, 2);
  });

  it("is not blocked by a modifier whose key-up was missed", () => {
    const t = setup("M");
    // Shift went down, its key-up never arrived (e.g. Win+L)
    t.down(KEYS.Shift);
    t.mods.shift = false;
    // The next event reports the real state
    t.down(KEYS.M);
    assert.deepEqual(t.events, ["M:down"]);
  });

  it("fires again for a new press", () => {
    const t = setup("F5");
    t.down(KEYS.F5);
    t.up(KEYS.F5);
    t.down(KEYS.F5);
    assert.deepEqual(t.events, ["F5:down", "F5:up", "F5:down"]);
  });

  it("matches either Enter key for plain Enter", () => {
    const t = setup("Enter");
    t.down(KEYS.NumpadEnter);
    t.up(KEYS.NumpadEnter);
    t.down(KEYS.Enter);
    assert.deepEqual(t.events, ["Enter:down", "Enter:up", "Enter:down"]);
  });

  it("uses the code for the main key", () => {
    const t = setup(["Z", "KeyY"]);
    t.down(KEYS.Z);
    assert.deepEqual(t.events, []);
    t.down(KEYS.Y);
    assert.deepEqual(t.events, ["Z:down"]);
  });

  it("releaseAll emits up for every active action", () => {
    const t = setup("F5", "Ctrl+M");
    t.down(KEYS.F5);
    t.down(KEYS.Ctrl);
    t.down(KEYS.M);
    t.matcher.releaseAll();
    assert.deepEqual(t.events, [
      "F5:down",
      "Ctrl+M:down",
      "F5:up",
      "Ctrl+M:up",
    ]);
    t.matcher.releaseAll();
    assert.equal(t.events.length, 4);
  });

  it("releases actions dropped by new bindings", () => {
    const t = setup("F5");
    t.down(KEYS.F5);
    t.matcher.setBindings([]);
    assert.deepEqual(t.events, ["F5:down", "F5:up"]);
  });
});
