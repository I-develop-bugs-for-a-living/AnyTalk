import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createKeyedThrottle,
  createViewerSoundGate,
  sanitizeWatching,
} from "./viewerThrottle";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sanitizeWatching", () => {
  test("keeps only strings of people in the room, without duplicates", () => {
    const list = ["a", "a", 5, "ghost", "b"];
    expect(sanitizeWatching(list, (id) => id !== "ghost")).toEqual(["a", "b"]);
  });

  test("caps the length", () => {
    const list = Array.from({ length: 200 }, (_, i) => `u${i}`);
    expect(sanitizeWatching(list, () => true, 50)).toHaveLength(50);
  });
});

describe("createKeyedThrottle", () => {
  test("applies the first value at once and the latest after a burst", () => {
    const apply = vi.fn();
    const throttle = createKeyedThrottle<number>(250, apply);

    for (let i = 0; i < 200; i++) throttle.push("a", i);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith("a", 0);

    vi.advanceTimersByTime(250);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith("a", 199);
  });

  test("keys are independent", () => {
    const apply = vi.fn();
    const throttle = createKeyedThrottle<number>(250, apply);
    throttle.push("a", 1);
    throttle.push("b", 1);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  test("applies again after a quiet time", () => {
    const apply = vi.fn();
    const throttle = createKeyedThrottle<number>(250, apply);
    throttle.push("a", 1);
    vi.advanceTimersByTime(300);
    throttle.push("a", 2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  test("clear drops what was held back", () => {
    const apply = vi.fn();
    const throttle = createKeyedThrottle<number>(250, apply);
    throttle.push("a", 1);
    throttle.push("a", 2);
    throttle.clear("a");
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe("createViewerSoundGate", () => {
  test("one real viewer joining plays one join sound", () => {
    const onSound = vi.fn();
    const gate = createViewerSoundGate({ onSound });
    gate.update(["a"]);
    expect(onSound).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onSound).toHaveBeenCalledTimes(1);
    expect(onSound).toHaveBeenCalledWith("join");
  });

  test("a viewer who leaves plays a leave sound", () => {
    const onSound = vi.fn();
    const gate = createViewerSoundGate({ onSound });
    gate.reset(["a"]);
    gate.update([]);
    vi.advanceTimersByTime(1000);
    expect(onSound).toHaveBeenCalledWith("leave");
  });

  test("flipping back within the window is silent", () => {
    const onSound = vi.fn();
    const gate = createViewerSoundGate({ onSound });
    for (let i = 0; i < 200; i++) gate.update(i % 2 ? [] : ["a"]);
    gate.update([]);
    vi.advanceTimersByTime(5000);
    expect(onSound).not.toHaveBeenCalled();
  });

  test("at most one sound per second", () => {
    const onSound = vi.fn();
    const gate = createViewerSoundGate({ onSound, settle: 100, gap: 1000 });
    gate.update(["a"]);
    vi.advanceTimersByTime(100);
    gate.update([]);
    vi.advanceTimersByTime(100);
    expect(onSound).toHaveBeenCalledTimes(1);
  });

  test("a viewer leaving the call makes no sound", () => {
    const onSound = vi.fn();
    const gate = createViewerSoundGate({
      onSound,
      shouldAnnounceLeave: () => false,
    });
    gate.reset(["a"]);
    gate.update([]);
    vi.advanceTimersByTime(1000);
    expect(onSound).not.toHaveBeenCalled();
  });

  test("a viewer dropping out of the room doesn't hide another change", () => {
    const onSound = vi.fn();
    const gate = createViewerSoundGate({
      onSound,
      shouldAnnounceLeave: (id) => id !== "a",
    });
    gate.reset(["a"]);
    gate.update(["b"]);
    vi.advanceTimersByTime(1000);
    expect(onSound).toHaveBeenCalledTimes(1);
    expect(onSound).toHaveBeenCalledWith("join");
  });
});
