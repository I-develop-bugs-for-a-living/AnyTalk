import { describe, expect, it } from "vitest";

import { maskButton, snapshotPad } from "./input";
import { parsePttButton } from "./pushToTalkButton";

describe("parsePttButton", () => {
  it("accepts known buttons only", () => {
    expect(parsePttButton("l3")).toBe("l3");
    expect(parsePttButton("select")).toBe("select");
    expect(parsePttButton("")).toBeNull();
    expect(parsePttButton("nope")).toBeNull();
    expect(parsePttButton(undefined)).toBeNull();
  });
});

describe("maskButton", () => {
  const held = (...indexes: number[]) =>
    snapshotPad({
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: indexes.includes(i),
        value: indexes.includes(i) ? 1 : 0,
      })),
    });

  it("hides the chosen button", () => {
    expect(maskButton(held(8), "select").pressed.select).toBe(false);
    expect(maskButton(held(12), "up").dpad.up).toBe(false);
  });

  it("keeps the others and does nothing without a button", () => {
    expect(maskButton(held(8, 0), "select").pressed.a).toBe(true);
    expect(maskButton(held(8), undefined).pressed.select).toBe(true);
    expect(maskButton(held(8), "l3").pressed.select).toBe(true);
  });
});
