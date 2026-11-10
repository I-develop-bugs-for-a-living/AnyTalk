import { describe, expect, test } from "vitest";

import {
  formatElapsed,
  nextOccupancyStart,
  releaseOccupancyMount,
  trackOccupancy,
} from "./voiceTimer";

describe("formatElapsed", () => {
  test("formats minutes and hours", () => {
    expect(formatElapsed(5000)).toBe("0:05");
    expect(formatElapsed(41 * 60000 + 50000)).toBe("41:50");
    expect(formatElapsed(3600000 + 2 * 60000 + 3000)).toBe("1:02:03");
  });
  test("clamps negative and invalid", () => {
    expect(formatElapsed(-500)).toBe("0:00");
    expect(formatElapsed(NaN)).toBe("0:00");
  });
});

describe("nextOccupancyStart", () => {
  test("uses the earliest join time", () => {
    expect(nextOccupancyStart(undefined, [30, 10, 20], 99)).toBe(10);
  });
  test("never moves later", () => {
    expect(nextOccupancyStart(10, [50], 99)).toBe(10);
    expect(nextOccupancyStart(10, [5], 99)).toBe(5);
  });
  test("ignores NaN and falls back to now", () => {
    expect(nextOccupancyStart(undefined, [NaN, 7], 99)).toBe(7);
    expect(nextOccupancyStart(undefined, [NaN], 99)).toBe(99);
    expect(nextOccupancyStart(10, [NaN], 99)).toBe(10);
  });
});

describe("trackOccupancy", () => {
  test("resets when the channel empties", () => {
    expect(trackOccupancy("c", [10], 99)).toBe(10);
    expect(trackOccupancy("c", [50], 99)).toBe(10);
    expect(trackOccupancy("c", [], 99)).toBeUndefined();
    expect(trackOccupancy("c", [50], 99)).toBe(50);
    trackOccupancy("c", []);
  });
});

describe("releaseOccupancyMount", () => {
  test("forgets the start only after the last timer unmounts", () => {
    trackOccupancy("m", [10], 99);
    // no mounts registered: releasing clears the start
    releaseOccupancyMount("m");
    expect(trackOccupancy("m", [50], 99)).toBe(50);
    trackOccupancy("m", []);
  });
});
