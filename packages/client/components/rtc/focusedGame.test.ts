import { describe, expect, it } from "vitest";

import { decideFocusedGameStream } from "./focusedGame";

describe("decideFocusedGameStream", () => {
  it("is unavailable without a game or a window when not streaming", () => {
    expect(decideFocusedGameStream(false, undefined, undefined)).toEqual({
      action: "unavailable",
    });
  });

  it("starts the focused game", () => {
    expect(decideFocusedGameStream(false, undefined, "b")).toEqual({
      action: "start",
      gameId: "b",
    });
  });

  it("prefers the focused game over the window in front", () => {
    expect(
      decideFocusedGameStream(false, undefined, "b", "window:1:0"),
    ).toEqual({ action: "start", gameId: "b" });
  });

  it("starts the window in front when it is no game", () => {
    expect(
      decideFocusedGameStream(false, undefined, undefined, "window:1:0"),
    ).toEqual({ action: "start-window", sourceId: "window:1:0" });
  });

  it("swaps to another focused game", () => {
    expect(decideFocusedGameStream(true, "a", "b")).toEqual({
      action: "swap",
      gameId: "b",
    });
  });

  it("swaps away from a manual stream", () => {
    expect(decideFocusedGameStream(true, undefined, "a")).toEqual({
      action: "swap",
      gameId: "a",
    });
  });

  it("swaps from a window stream to a game", () => {
    expect(
      decideFocusedGameStream(true, undefined, "a", undefined, "window:1:0"),
    ).toEqual({ action: "swap", gameId: "a" });
  });

  it("stops when the streamed game is focused", () => {
    expect(decideFocusedGameStream(true, "a", "a")).toEqual({
      action: "stop",
    });
  });

  it("stops when nothing capturable is in front", () => {
    expect(decideFocusedGameStream(true, "a", undefined)).toEqual({
      action: "stop",
    });
  });

  it("stops when the streamed window is in front again", () => {
    expect(
      decideFocusedGameStream(
        true,
        undefined,
        undefined,
        "window:1:0",
        "window:1:0",
      ),
    ).toEqual({ action: "stop" });
  });

  it("swaps from one window to another", () => {
    expect(
      decideFocusedGameStream(
        true,
        undefined,
        undefined,
        "window:2:0",
        "window:1:0",
      ),
    ).toEqual({ action: "swap-window", sourceId: "window:2:0" });
  });

  it("swaps from a game stream to the window in front", () => {
    expect(decideFocusedGameStream(true, "a", undefined, "window:2:0")).toEqual(
      { action: "swap-window", sourceId: "window:2:0" },
    );
  });

  it("swaps from a hand-picked stream to the window in front", () => {
    expect(
      decideFocusedGameStream(true, undefined, undefined, "window:2:0"),
    ).toEqual({ action: "swap-window", sourceId: "window:2:0" });
  });
});
