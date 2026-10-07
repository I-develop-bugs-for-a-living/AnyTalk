import { describe, expect, test } from "vitest";

import { rms } from "./audioLevel";

describe("rms", () => {
  test("is 0 for no samples", () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });

  test("is 0 for silence", () => {
    expect(rms(new Float32Array(128))).toBe(0);
  });

  test("is the amplitude of a constant signal", () => {
    expect(rms(new Float32Array(64).fill(-0.5))).toBeCloseTo(0.5);
  });

  test("is amplitude / sqrt(2) for a sine wave", () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.8 * Math.sin((2 * Math.PI * i * 10) / samples.length);
    }
    expect(rms(samples)).toBeCloseTo(0.8 / Math.SQRT2, 3);
  });
});
