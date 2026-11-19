import { describe, expect, it } from "vitest";

import { AppAudioRing } from "./appAudioRing";

/** Interleaved stereo samples where left is n and right is -n. */
const frames = (...values: number[]) =>
  new Float32Array(values.flatMap((v) => [v, -v]));

describe("AppAudioRing", () => {
  it("stays silent until the prefill is queued", () => {
    const ring = new AppAudioRing(8, 4);
    ring.write(frames(1, 2));
    const left = new Float32Array(2);
    const right = new Float32Array(2);
    expect(ring.read(left, right)).toBe(0);
    expect([...left]).toEqual([0, 0]);
    ring.write(frames(3, 4));
    expect(ring.read(left, right)).toBe(2);
    expect([...left]).toEqual([1, 2]);
    expect([...right]).toEqual([-1, -2]);
  });

  it("pads with silence and primes again after running dry", () => {
    const ring = new AppAudioRing(8, 2);
    ring.write(frames(1, 2));
    const left = new Float32Array(4);
    const right = new Float32Array(4);
    expect(ring.read(left, right)).toBe(2);
    expect([...left]).toEqual([1, 2, 0, 0]);
    expect(ring.playing).toBe(false);
    ring.write(frames(5));
    expect(ring.read(left, right)).toBe(0);
    ring.write(frames(6));
    expect(ring.read(left, right)).toBe(2);
    expect([...left]).toEqual([5, 6, 0, 0]);
  });

  it("drops the oldest frames down to the prefill when it overruns", () => {
    const ring = new AppAudioRing(6, 4);
    expect(ring.write(frames(1, 2, 3, 4))).toBe(0);
    // 4 queued + 3 new > 6: keep 1 old frame, so about 4 queued afterwards
    expect(ring.write(frames(5, 6, 7))).toBe(3);
    expect(ring.queued).toBe(4);
    const left = new Float32Array(4);
    ring.read(left, new Float32Array(4));
    expect([...left]).toEqual([4, 5, 6, 7]);
  });

  it("keeps only the newest part of a chunk bigger than the ring", () => {
    const ring = new AppAudioRing(2, 1);
    expect(ring.write(frames(1, 2, 3, 4))).toBe(2);
    const left = new Float32Array(2);
    ring.read(left, new Float32Array(2));
    expect([...left]).toEqual([3, 4]);
  });

  it("wraps around the end of the ring", () => {
    const ring = new AppAudioRing(3, 1);
    const left = new Float32Array(2);
    const right = new Float32Array(2);
    ring.write(frames(1, 2));
    ring.read(left, right);
    ring.write(frames(3, 4));
    ring.read(left, right);
    expect([...left]).toEqual([3, 4]);
  });
});
