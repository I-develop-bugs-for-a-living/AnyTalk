import { describe, expect, it } from "vitest";

import {
  bestWindow,
  countMissed,
  followDecision,
  graceWaitMs,
  graceWindow,
  isStalled,
} from "./gameFollow";

const win = (sourceId: string, role: "game" | "client" = "game") => ({
  sourceId,
  title: sourceId,
  role,
});
const game = (id: string, windows: RunningGameWindow[]): RunningGame => ({
  id,
  name: id,
  windows,
});

describe("bestWindow", () => {
  it("takes the first window", () => {
    expect(
      bestWindow(game("a", [win("1"), win("2", "client")]))?.sourceId,
    ).toBe("1");
  });
  it("is undefined without windows", () => {
    expect(bestWindow(game("a", []))).toBeUndefined();
    expect(bestWindow(undefined)).toBeUndefined();
  });
});

describe("followDecision", () => {
  const followed = { gameId: "a", sourceId: "1" };

  it("keeps the window when it is still the best", () => {
    expect(followDecision([game("a", [win("1")])], followed)).toEqual({
      type: "keep",
    });
  });
  it("switches when the game window changed", () => {
    expect(
      followDecision([game("a", [win("2"), win("1", "client")])], followed),
    ).toEqual({ type: "switch", sourceId: "2" });
  });
  it("keeps when the game has no window", () => {
    expect(followDecision([game("a", [])], followed)).toEqual({
      type: "keep",
    });
  });
  it("keeps following after one update without the game", () => {
    expect(followDecision([], { ...followed, missed: 1 })).toEqual({
      type: "keep",
    });
  });
  it("releases after two updates without the game", () => {
    expect(followDecision([], { ...followed, missed: 2 })).toEqual({
      type: "release",
    });
  });
  it("releases when the game stopped", () => {
    expect(followDecision([game("b", [win("1")])], followed)).toEqual({
      type: "release",
    });
  });
});

describe("graceWindow", () => {
  it("finds another window of the game", () => {
    expect(graceWindow([game("a", [win("2")])], "a", "1")).toEqual({
      sourceId: "2",
      gone: false,
      missed: 0,
    });
  });
  it("ignores the window that ended", () => {
    expect(graceWindow([game("a", [win("1")])], "a", "1")).toEqual({
      sourceId: undefined,
      gone: false,
      missed: 0,
    });
  });
  it("reports a game that stopped", () => {
    expect(graceWindow([], "a", "1")).toEqual({ gone: true, missed: 2 });
  });
  it("keeps waiting after a single missing update", () => {
    expect(graceWindow([], "a", "1", 0)).toEqual({ gone: false, missed: 1 });
  });
  it("keeps waiting while the game runs without a window", () => {
    expect(graceWindow([game("a", [])], "a", "1").gone).toBe(false);
  });
});

describe("isStalled", () => {
  it("is not stalled without readings", () => {
    expect(isStalled([])).toBe(false);
  });
  it("is not stalled while frames grow", () => {
    expect(
      isStalled([
        { at: 0, frames: 1 },
        { at: 2000, frames: 5 },
        { at: 4000, frames: 9 },
        { at: 6000, frames: 14 },
      ]),
    ).toBe(false);
  });
  it("is stalled when the counter stood still long enough", () => {
    expect(
      isStalled([
        { at: 0, frames: 9 },
        { at: 2000, frames: 9 },
        { at: 4000, frames: 9 },
        { at: 6000, frames: 9 },
      ]),
    ).toBe(true);
  });
  it("waits for the full time", () => {
    expect(
      isStalled([
        { at: 0, frames: 5 },
        { at: 2000, frames: 9 },
        { at: 4000, frames: 9 },
      ]),
    ).toBe(false);
  });
  it("recovers when frames flow again", () => {
    expect(
      isStalled([
        { at: 0, frames: 9 },
        { at: 6000, frames: 9 },
        { at: 8000, frames: 12 },
      ]),
    ).toBe(false);
  });
});

describe("countMissed", () => {
  it("counts updates in a row without the game", () => {
    expect(countMissed([], "a", 0)).toBe(1);
    expect(countMissed([], "a", 1)).toBe(2);
  });
  it("starts over when the game is back", () => {
    expect(countMissed([game("a", [])], "a", 1)).toBe(0);
  });
});

describe("graceWaitMs", () => {
  it("waits long when the window is no longer listed", () => {
    expect(graceWaitMs([game("a", [win("2")])], "a", "1")).toBe(90_000);
    expect(graceWaitMs([game("a", [])], "a", "1")).toBe(90_000);
  });
  it("waits briefly when the window is still listed", () => {
    expect(graceWaitMs([game("a", [win("1")])], "a", "1")).toBe(4000);
  });
});
