import { describe, expect, it } from "vitest";

import {
  bestWindow,
  countMissed,
  FOLLOW_GRACE_MAX_MS,
  FOLLOW_GRACE_SHORT_MS,
  followDecision,
  graceWaitMs,
  graceWindow,
  isFlowing,
  isStalled,
  REFRESH_MAX_ATTEMPTS,
  REFRESH_SPACING_MS,
  refreshAllowed,
  SWAP_TO_GAME_DELAY_MS,
  swapDelayMs,
  windowListed,
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
    expect(graceWaitMs([game("a", [win("1")])], "a", "1")).toBe(
      FOLLOW_GRACE_SHORT_MS,
    );
  });
});

describe("windowListed", () => {
  it("finds a listed window", () => {
    const games = [game("a", [win("1")])];
    expect(windowListed(games, "a", "1")).toBe(true);
    expect(windowListed(games, "a", "2")).toBe(false);
    expect(windowListed(games, "b", "1")).toBe(false);
  });
  it("picks the wait by whether the window is listed", () => {
    const games = [game("a", [win("1")])];
    expect(graceWaitMs(games, "a", "1")).toBe(FOLLOW_GRACE_SHORT_MS);
    expect(graceWaitMs([], "a", "1")).toBe(FOLLOW_GRACE_MAX_MS);
  });
});

describe("refreshAllowed", () => {
  it("allows the first attempt", () => {
    expect(refreshAllowed(undefined, "1", 0)).toBe(true);
  });
  it("waits for the spacing", () => {
    const state = { sourceId: "1", attempts: 1, lastAt: 1000 };
    expect(refreshAllowed(state, "1", 1000 + REFRESH_SPACING_MS - 1)).toBe(
      false,
    );
    expect(refreshAllowed(state, "1", 1000 + REFRESH_SPACING_MS)).toBe(true);
  });
  it("stops after the maximum attempts", () => {
    const state = { sourceId: "1", attempts: REFRESH_MAX_ATTEMPTS, lastAt: 0 };
    expect(refreshAllowed(state, "1", 1e9)).toBe(false);
  });
  it("starts anew for another window", () => {
    const state = { sourceId: "1", attempts: REFRESH_MAX_ATTEMPTS, lastAt: 0 };
    expect(refreshAllowed(state, "2", 1)).toBe(true);
  });
});

describe("followDecision refresh", () => {
  const games = [game("a", [win("1")])];

  it("refreshes a stalled best window", () => {
    expect(
      followDecision(games, {
        gameId: "a",
        sourceId: "1",
        stalled: true,
        now: 1,
      }),
    ).toEqual({ type: "refresh" });
  });
  it("keeps when not stalled or not allowed", () => {
    expect(followDecision(games, { gameId: "a", sourceId: "1" })).toEqual({
      type: "keep",
    });
    expect(
      followDecision(games, {
        gameId: "a",
        sourceId: "1",
        stalled: true,
        refresh: { sourceId: "1", attempts: 1, lastAt: 0 },
        now: 100,
      }),
    ).toEqual({ type: "keep" });
  });
});

describe("swapDelayMs", () => {
  const games = [game("a", [win("g"), win("c", "client")])];

  it("delays the move from the client to a game window", () => {
    expect(swapDelayMs(games, { gameId: "a", sourceId: "c" }, "g")).toBe(
      SWAP_TO_GAME_DELAY_MS,
    );
  });
  it("does not delay other moves", () => {
    expect(swapDelayMs(games, { gameId: "a", sourceId: "g" }, "c")).toBe(0);
    expect(swapDelayMs(games, { gameId: "a", sourceId: "x" }, "g")).toBe(0);
  });
});

describe("isFlowing", () => {
  it("needs a long enough rise", () => {
    const rising = [0, 2000, 4000, 6000, 8000, 10000].map((at, i) => ({
      at,
      frames: i * 30,
    }));
    expect(isFlowing(rising, 10000)).toBe(true);
    expect(isFlowing(rising.slice(-3), 10000)).toBe(false);
  });
  it("breaks when the counter stands still or drops", () => {
    const still = [0, 2000, 4000, 6000, 8000, 10000].map((at, i) => ({
      at,
      frames: i === 5 ? 120 : i * 30,
    }));
    still[5].frames = still[4].frames;
    expect(isFlowing(still, 10000)).toBe(false);
    expect(isFlowing([])).toBe(false);
  });
});
