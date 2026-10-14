import { describe, expect, it } from "vitest";

import { decideFocusedGameStream } from "./focusedGame";

describe("decideFocusedGameStream", () => {
  it("does nothing without games when not streaming", () => {
    expect(decideFocusedGameStream(false, undefined, [], undefined)).toEqual({
      action: "none",
    });
  });

  it("starts the focused game", () => {
    expect(decideFocusedGameStream(false, undefined, ["a", "b"], "b")).toEqual({
      action: "start",
      gameId: "b",
    });
  });

  it("starts the first game when none is focused", () => {
    expect(
      decideFocusedGameStream(false, undefined, ["a", "b"], undefined),
    ).toEqual({ action: "start", gameId: "a" });
  });

  it("swaps to another focused game", () => {
    expect(decideFocusedGameStream(true, "a", ["a", "b"], "b")).toEqual({
      action: "swap",
      gameId: "b",
    });
  });

  it("swaps away from a manual stream", () => {
    expect(decideFocusedGameStream(true, undefined, ["a"], "a")).toEqual({
      action: "swap",
      gameId: "a",
    });
  });

  it("stops when the streamed game is focused", () => {
    expect(decideFocusedGameStream(true, "a", ["a"], "a")).toEqual({
      action: "stop",
    });
  });

  it("stops when no game is focused", () => {
    expect(decideFocusedGameStream(true, "a", ["a"], undefined)).toEqual({
      action: "stop",
    });
  });
});
