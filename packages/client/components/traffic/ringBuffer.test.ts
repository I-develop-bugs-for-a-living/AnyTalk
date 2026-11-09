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
