import { describe, expect, it } from "vitest";

import { RingBuffer } from "./ringBuffer";

describe("RingBuffer", () => {
  it("keeps order below the cap", () => {
    const b = new RingBuffer<number>(3);
    b.push(1);
    b.push(2);
    expect(b.toArray()).toEqual([1, 2]);
  });

  it("drops the oldest items past the cap", () => {
    const b = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) b.push(i);
    expect(b.toArray()).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
  });

  it("clears", () => {
    const b = new RingBuffer<number>(2);
    b.push(1);
    b.clear();
    expect(b.toArray()).toEqual([]);
    b.push(9);
    expect(b.toArray()).toEqual([9]);
  });
});

describe("RingBuffer memory budget", () => {
  const budget = (maxBytes: number) => ({
    maxBytes,
    sizeOf: (s: string) => s.length,
  });

  it("drops the oldest items while over the budget", () => {
    const b = new RingBuffer<string>(10, budget(10));
    b.push("aaaa");
    b.push("bbbb");
    expect(b.bytes).toBe(8);
    b.push("cccc");
    expect(b.toArray()).toEqual(["bbbb", "cccc"]);
    expect(b.bytes).toBe(8);
    expect(b.dropped).toBe(1);
  });

  it("always keeps the newest item, even when it alone is too big", () => {
    const b = new RingBuffer<string>(10, budget(3));
    b.push("a");
    b.push("bbbbbbbb");
    expect(b.toArray()).toEqual(["bbbbbbbb"]);
    expect(b.dropped).toBe(1);
  });

  it("counts drops from the count cap and resets on clear", () => {
    const b = new RingBuffer<string>(2, budget(100));
    for (const s of ["a", "b", "c", "d"]) b.push(s);
    expect(b.dropped).toBe(2);
    expect(b.bytes).toBe(2);
    b.clear();
    expect(b.dropped).toBe(0);
    expect(b.bytes).toBe(0);
  });

  it("keeps counting right after wrapping around", () => {
    const b = new RingBuffer<string>(3, budget(6));
    for (const s of ["aa", "bb", "cc", "dd", "ee"]) b.push(s);
    expect(b.toArray()).toEqual(["cc", "dd", "ee"]);
    expect(b.bytes).toBe(6);
  });
});

describe("RingBuffer failing size estimate", () => {
  it("keeps the item and assumes a fixed size", () => {
    const b = new RingBuffer<string>(5, {
      maxBytes: 10_000,
      sizeOf: () => {
        throw new Error("boom");
      },
    });
    b.push("a");
    expect(b.toArray()).toEqual(["a"]);
    expect(b.bytes).toBeGreaterThan(0);
  });
});
