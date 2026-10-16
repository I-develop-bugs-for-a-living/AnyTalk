import { describe, expect, it } from "vitest";

import {
  ControllerAction as A,
  DEFAULT_BINDINGS,
  actionForButton,
  cleanBindingOverrides,
  rebind,
  rebindBlocker,
  resetAction,
  resolveBindings,
  unbind,
} from "./bindings";

describe("resolveBindings", () => {
  it("gives the defaults when nothing was changed", () => {
    expect(resolveBindings({})).toEqual(DEFAULT_BINDINGS);
    expect(resolveBindings(undefined)).toEqual(DEFAULT_BINDINGS);
  });

  it("puts overrides on top and unbinds the loser of a clash", () => {
    const bindings = resolveBindings({ [A.TOGGLE_DEAFEN]: "y" });
    expect(bindings[A.TOGGLE_DEAFEN]).toBe("y");
    expect(bindings[A.FOCUS_COMPOSER]).toBeNull();
  });

  it("never takes an essential action's button for an optional one", () => {
    const bindings = resolveBindings({ [A.FOCUS_COMPOSER]: "a" });
    expect(bindings[A.ACTIVATE]).toBe("a");
    expect(bindings[A.FOCUS_COMPOSER]).toBeNull();
  });

  it("keeps essential actions bound", () => {
    expect(resolveBindings({ [A.ACTIVATE]: null })[A.ACTIVATE]).toBe("a");
  });
});

describe("actionForButton", () => {
  it("finds the action of a button", () => {
    expect(actionForButton(DEFAULT_BINDINGS, "a")).toBe(A.ACTIVATE);
    expect(actionForButton(DEFAULT_BINDINGS, "l3")).toBeUndefined();
  });
});

describe("rebind", () => {
  it("moves an action to a free button", () => {
    const next = rebind({}, A.FOCUS_COMPOSER, "l3");
    const bindings = resolveBindings(next);
    expect(bindings[A.FOCUS_COMPOSER]).toBe("l3");
    expect(actionForButton(bindings, "y")).toBeUndefined();
  });

  it("swaps with the action that had the button", () => {
    const bindings = resolveBindings(rebind({}, A.ACTIVATE, "b"));
    expect(bindings[A.ACTIVATE]).toBe("b");
    expect(bindings[A.BACK]).toBe("a");
  });

  it("unbinds an optional action that had nothing to hand over", () => {
    const bindings = resolveBindings(rebind({}, A.TOGGLE_DEAFEN, "y"));
    expect(bindings[A.TOGGLE_DEAFEN]).toBe("y");
    expect(bindings[A.FOCUS_COMPOSER]).toBeNull();
  });

  it("refuses to leave an essential action without a button", () => {
    expect(rebindBlocker({}, A.TOGGLE_DEAFEN, "a")).toBe(A.ACTIVATE);
    expect(rebind({}, A.TOGGLE_DEAFEN, "a")).toEqual({});
  });

  it("stores nothing for the defaults", () => {
    expect(rebind({}, A.ACTIVATE, "a")).toEqual({});
    expect(rebind(rebind({}, A.ACTIVATE, "b"), A.ACTIVATE, "a")).toEqual({});
  });
});

describe("unbind and reset", () => {
  it("unbinds optional actions only", () => {
    expect(
      resolveBindings(unbind({}, A.TOGGLE_MUTE))[A.TOGGLE_MUTE],
    ).toBeNull();
    expect(unbind({}, A.BACK)).toEqual({});
  });

  it("resets one action by swapping back", () => {
    const changed = rebind({}, A.ACTIVATE, "b");
    expect(resetAction(changed, A.ACTIVATE)).toEqual({});
  });

  it("resets an action with no default to unbound", () => {
    const changed = rebind({}, A.TOGGLE_DEAFEN, "l3");
    expect(resetAction(changed, A.TOGGLE_DEAFEN)).toEqual({});
  });
});

describe("cleanBindingOverrides", () => {
  it("drops unknown actions and buttons", () => {
    expect(
      cleanBindingOverrides({
        activate: "b",
        nope: "a",
        back: "up",
        toggleMute: null,
      }),
    ).toEqual({ activate: "b", toggleMute: null });
  });

  it("rejects non-objects", () => {
    expect(cleanBindingOverrides("a")).toBeUndefined();
    expect(cleanBindingOverrides([])).toBeUndefined();
  });
});
