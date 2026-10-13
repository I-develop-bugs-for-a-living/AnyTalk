import { describe, expect, it } from "vitest";

import { bestWindow, followDecision, graceWindow } from "./gameFollow";

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
    });
  });
  it("ignores the window that ended", () => {
    expect(graceWindow([game("a", [win("1")])], "a", "1")).toEqual({
      sourceId: undefined,
      gone: false,
    });
  });
  it("reports a game that stopped", () => {
    expect(graceWindow([], "a", "1")).toEqual({ gone: true });
  });
});
