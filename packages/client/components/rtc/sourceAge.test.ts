import { describe, expect, test } from "vitest";

import { sourceAge } from "./sourceAge";

describe("sourceAge", () => {
  const perfNow = 12_345;
  const epochNow = 1_790_000_000_000 + perfNow;

  test("reads timestamps on the performance timeline", () => {
    expect(sourceAge(perfNow - 100, perfNow, epochNow)).toBe(100);
  });

  test("reads timestamps in epoch time", () => {
    expect(sourceAge(epochNow - 100, perfNow, epochNow)).toBe(100);
  });

  test("treats slightly future timestamps as fresh", () => {
    expect(sourceAge(perfNow + 5, perfNow, epochNow)).toBe(5);
  });
});
