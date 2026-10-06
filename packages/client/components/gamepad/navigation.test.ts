import { describe, expect, it } from "vitest";

import {
  type FocusContext,
  activationKind,
  isTextField,
  isVerticallyScrollable,
  moveStrategy,
  neighbourIndex,
  stepDelta,
  stepIndex,
  stepNumber,
  steppedWidget,
} from "./navigation";

/** Build a focus context, defaulting to a plain button */
const ctx = (overrides: Partial<FocusContext> = {}): FocusContext => ({
  tag: "button",
  isContentEditable: false,
  inContextMenu: false,
  isMessageItem: false,
  ...overrides,
});

describe("isTextField", () => {
  it("detects text inputs, textareas and editable content", () => {
    expect(isTextField(ctx({ tag: "input", inputType: "text" }))).toBe(true);
    expect(isTextField(ctx({ tag: "input" }))).toBe(true);
    expect(isTextField(ctx({ tag: "input", inputType: "password" }))).toBe(
      true,
    );
    expect(isTextField(ctx({ tag: "textarea" }))).toBe(true);
    expect(isTextField(ctx({ tag: "div", isContentEditable: true }))).toBe(
      true,
    );
  });

  it("rejects buttons and non-text inputs", () => {
    expect(isTextField(ctx())).toBe(false);
    expect(isTextField(ctx({ tag: "input", inputType: "checkbox" }))).toBe(
      false,
    );
    expect(isTextField(ctx({ tag: "input", inputType: "range" }))).toBe(false);
  });
});

describe("moveStrategy", () => {
  it("leaves keys to context menus", () => {
    const menu = ctx({ tag: "a", role: "menuitem", inContextMenu: true });
    expect(moveStrategy(menu, "up")).toBe("keys");
    expect(moveStrategy(menu, "right")).toBe("keys");
  });

  it("sends vertical moves to the message list, horizontal ones go spatial", () => {
    const message = ctx({ tag: "div", isMessageItem: true });
    expect(moveStrategy(message, "down")).toBe("message-list");
    expect(moveStrategy(message, "up")).toBe("message-list");
    expect(moveStrategy(message, "left")).toBe("spatial");
    expect(moveStrategy(message, "right")).toBe("spatial");
  });

  it("steps selects sideways and moves up and down spatially", () => {
    const select = ctx({ tag: "select" });
    expect(moveStrategy(select, "left")).toBe("select-step");
    expect(moveStrategy(select, "right")).toBe("select-step");
    expect(moveStrategy(select, "down")).toBe("spatial");
  });

  it("tries keys first in text fields", () => {
    const input = ctx({ tag: "input", inputType: "text" });
    for (const direction of ["up", "down", "left", "right"] as const) {
      expect(moveStrategy(input, direction)).toBe("keys-then-spatial");
    }
  });

  it("uses spatial navigation otherwise, also with nothing focused", () => {
    expect(moveStrategy(ctx(), "down")).toBe("spatial");
    expect(moveStrategy(ctx({ tag: "" }), "left")).toBe("spatial");
  });
});

describe("activationKind", () => {
  it("clicks buttons, links and checkboxes", () => {
    expect(activationKind(ctx())).toBe("click");
    expect(activationKind(ctx({ tag: "a" }))).toBe("click");
    expect(activationKind(ctx({ tag: "input", inputType: "checkbox" }))).toBe(
      "click",
    );
  });

  it("clicks context menu items but not the menu itself", () => {
    expect(
      activationKind(ctx({ tag: "a", role: "menuitem", inContextMenu: true })),
    ).toBe("click");
    expect(
      activationKind(ctx({ tag: "div", role: "menu", inContextMenu: true })),
    ).toBe("none");
  });

  it("sends Enter to text fields and messages", () => {
    expect(activationKind(ctx({ tag: "input", inputType: "text" }))).toBe(
      "enter",
    );
    expect(activationKind(ctx({ tag: "div", isContentEditable: true }))).toBe(
      "enter",
    );
    expect(activationKind(ctx({ tag: "div", isMessageItem: true }))).toBe(
      "enter",
    );
  });

  it("opens the list of a select", () => {
    expect(activationKind(ctx({ tag: "select" }))).toBe("picker");
  });

  it("does nothing when nothing is focused", () => {
    expect(activationKind(ctx({ tag: "" }))).toBe("none");
    expect(activationKind(ctx({ tag: "body" }))).toBe("none");
  });
});

describe("stepIndex", () => {
  it("steps within the list without wrapping", () => {
    expect(stepIndex(3, 1, 1)).toBe(2);
    expect(stepIndex(3, 1, -1)).toBe(0);
    expect(stepIndex(3, 2, 1)).toBe(2);
    expect(stepIndex(3, 0, -1)).toBe(0);
  });

  it("handles no selection and empty lists", () => {
    expect(stepIndex(3, -1, 1)).toBe(0);
    expect(stepIndex(3, -1, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("isVerticallyScrollable", () => {
  it("needs a scrolling overflow and overflowing content", () => {
    expect(isVerticallyScrollable("auto", 500, 300)).toBe(true);
    expect(isVerticallyScrollable("scroll", 500, 300)).toBe(true);
    expect(isVerticallyScrollable("hidden", 500, 300)).toBe(false);
    expect(isVerticallyScrollable("visible", 500, 300)).toBe(false);
    expect(isVerticallyScrollable("auto", 300, 300)).toBe(false);
    expect(isVerticallyScrollable("auto", 300.5, 300)).toBe(false);
  });
});

describe("stepped widgets", () => {
  it("recognises sliders, radios and tabs, including mdui hosts", () => {
    expect(steppedWidget(ctx({ tag: "mdui-slider" }))).toBe("slider");
    expect(steppedWidget(ctx({ tag: "input", inputType: "range" }))).toBe(
      "slider",
    );
    expect(steppedWidget(ctx({ tag: "mdui-radio" }))).toBe("radio");
    expect(steppedWidget(ctx({ tag: "input", inputType: "radio" }))).toBe(
      "radio",
    );
    expect(steppedWidget(ctx({ role: "tab" }))).toBe("tab");
    expect(steppedWidget(ctx())).toBeUndefined();
  });

  it("steps sliders with left and right, not up and down", () => {
    const slider = ctx({ tag: "mdui-slider" });
    expect(stepDelta(slider, "left")).toBe(-1);
    expect(stepDelta(slider, "right")).toBe(1);
    expect(stepDelta(slider, "up")).toBe(0);
    const vertical = { ...slider, orientation: "vertical" };
    expect(stepDelta(vertical, "up")).toBe(1);
    expect(stepDelta(vertical, "down")).toBe(-1);
    expect(stepDelta(vertical, "left")).toBe(0);
  });

  it("steps radios and tabs along their axis", () => {
    const radio = ctx({ tag: "input", inputType: "radio" });
    expect(stepDelta(radio, "left")).toBe(-1);
    expect(stepDelta(radio, "right")).toBe(1);
    expect(stepDelta(radio, "down")).toBe(0);
    const tab = ctx({ role: "tab", orientation: "vertical" });
    expect(stepDelta(tab, "up")).toBe(-1);
    expect(stepDelta(tab, "down")).toBe(1);
    expect(stepDelta(tab, "right")).toBe(0);
  });

  it("picks a strategy", () => {
    expect(moveStrategy(ctx({ tag: "mdui-slider" }), "right")).toBe(
      "step-widget",
    );
    expect(moveStrategy(ctx({ tag: "mdui-slider" }), "down")).toBe("spatial");
    expect(moveStrategy(ctx(), "left")).toBe("spatial");
  });

  it("treats the mdui text field as a text field", () => {
    expect(isTextField(ctx({ tag: "mdui-text-field" }))).toBe(true);
    expect(moveStrategy(ctx({ tag: "mdui-text-field" }), "left")).toBe(
      "keys-then-spatial",
    );
  });
});

describe("stepNumber", () => {
  it("steps within the range", () => {
    expect(stepNumber(5, 0, 10, 1, 1)).toBe(6);
    expect(stepNumber(5, 0, 10, 2, -1)).toBe(3);
    expect(stepNumber(0.1, 0, 1, 0.2, 1)).toBe(0.3);
  });

  it("clamps, and returns undefined at the ends", () => {
    expect(stepNumber(9.5, 0, 10, 1, 1)).toBe(10);
    expect(stepNumber(10, 0, 10, 1, 1)).toBeUndefined();
    expect(stepNumber(0, 0, 10, 1, -1)).toBeUndefined();
  });

  it("copes with a bad step or value", () => {
    expect(stepNumber(3, 0, 10, NaN, 1)).toBe(4);
    expect(stepNumber(NaN, 0, 10, 1, 1)).toBe(1);
  });
});

describe("neighbourIndex", () => {
  it("returns the neighbour or -1 at the ends", () => {
    expect(neighbourIndex(3, 1, 1)).toBe(2);
    expect(neighbourIndex(3, 1, -1)).toBe(0);
    expect(neighbourIndex(3, 2, 1)).toBe(-1);
    expect(neighbourIndex(3, 0, -1)).toBe(-1);
    expect(neighbourIndex(3, -1, 1)).toBe(-1);
  });
});
