import { describe, expect, it } from "vitest";

import {
  type Candidate,
  type Rect,
  hasArea,
  isInDirection,
  isInViewport,
  nextRegion,
  pickBest,
  pickFirst,
  scoreCandidate,
} from "./spatial";

/** Build a rectangle from position and size */
const box = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("hasArea", () => {
  it("accepts a normal rectangle", () => {
    expect(hasArea(box(0, 0))).toBe(true);
  });

  it("rejects empty and inverted rectangles", () => {
    expect(hasArea(box(0, 0, 0, 10))).toBe(false);
    expect(hasArea(box(0, 0, 10, 0))).toBe(false);
    expect(hasArea({ left: 10, top: 10, right: 0, bottom: 0 })).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(hasArea({ left: NaN, top: 0, right: 10, bottom: 10 })).toBe(false);
    expect(hasArea({ left: 0, top: 0, right: Infinity, bottom: 10 })).toBe(
      false,
    );
  });
});

describe("isInViewport", () => {
  it("accepts rectangles that overlap the viewport", () => {
    expect(isInViewport(box(10, 10), 800, 600)).toBe(true);
    expect(isInViewport(box(-50, 10), 800, 600)).toBe(true);
  });

  it("rejects rectangles fully outside", () => {
    expect(isInViewport(box(-200, 10), 800, 600)).toBe(false);
    expect(isInViewport(box(10, 700), 800, 600)).toBe(false);
    expect(isInViewport(box(900, 10), 800, 600)).toBe(false);
  });
});

describe("isInDirection", () => {
  const from = box(100, 100);

  it("detects each direction", () => {
    expect(isInDirection(from, box(100, 200), "down")).toBe(true);
    expect(isInDirection(from, box(100, 0), "up")).toBe(true);
    expect(isInDirection(from, box(300, 100), "right")).toBe(true);
    expect(isInDirection(from, box(-100, 100), "left")).toBe(true);
  });

  it("rejects the opposite direction", () => {
    expect(isInDirection(from, box(100, 200), "up")).toBe(false);
    expect(isInDirection(from, box(300, 100), "left")).toBe(false);
  });

  it("rejects an identical rectangle", () => {
    for (const direction of ["up", "down", "left", "right"] as const) {
      expect(isInDirection(from, from, direction)).toBe(false);
    }
  });

  it("rejects an element inside the start", () => {
    const outer = box(0, 0, 400, 400);
    const inner = box(50, 50, 20, 20);
    for (const direction of ["up", "down", "left", "right"] as const) {
      expect(isInDirection(outer, inner, direction)).toBe(false);
    }
  });

  it("accepts partly overlapping rectangles that reach past the edge", () => {
    expect(isInDirection(from, box(100, 120), "down")).toBe(true);
  });
});

describe("scoreCandidate", () => {
  it("is infinite for candidates in another direction", () => {
    expect(scoreCandidate(box(0, 0), box(0, 100), "up")).toBe(Infinity);
  });

  it("prefers a nearer candidate in line", () => {
    const from = box(0, 0);
    expect(scoreCandidate(from, box(0, 60), "down")).toBeLessThan(
      scoreCandidate(from, box(0, 200), "down"),
    );
  });

  it("prefers an aligned candidate over a nearer diagonal one", () => {
    const from = box(0, 0);
    const aligned = box(0, 200);
    const diagonal = box(300, 50);
    expect(scoreCandidate(from, aligned, "down")).toBeLessThan(
      scoreCandidate(from, diagonal, "down"),
    );
  });

  it("works for horizontal moves", () => {
    const from = box(0, 0);
    expect(scoreCandidate(from, box(150, 0), "right")).toBeLessThan(
      scoreCandidate(from, box(150, 200), "right"),
    );
  });
});

describe("pickBest", () => {
  it("moves through a grid in every direction", () => {
    // 3x3 grid of 100x40 cells with 20px gaps
    const cells: Candidate[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        cells.push({ rect: box(col * 120, row * 60) });
      }
    }
    const center = cells[4].rect;
    const others = cells.filter((_, i) => i !== 4);

    expect(others[pickBest(center, others, "up")]).toBe(cells[1]);
    expect(others[pickBest(center, others, "down")]).toBe(cells[7]);
    expect(others[pickBest(center, others, "left")]).toBe(cells[3]);
    expect(others[pickBest(center, others, "right")]).toBe(cells[5]);
  });

  it("returns -1 when nothing lies in that direction", () => {
    const candidates: Candidate[] = [{ rect: box(0, 200) }];
    expect(pickBest(box(0, 0), candidates, "up")).toBe(-1);
    expect(pickBest(box(0, 0), [], "down")).toBe(-1);
  });

  it("ignores candidates without an area", () => {
    const candidates: Candidate[] = [
      { rect: box(0, 100, 0, 0) },
      { rect: box(0, 300) },
    ];
    expect(pickBest(box(0, 0), candidates, "down")).toBe(1);
  });

  it("prefers staying inside the current region", () => {
    const from = box(0, 0);
    const candidates: Candidate[] = [
      { rect: box(0, 100), region: "other" },
      { rect: box(0, 160), region: "here" },
    ];
    expect(pickBest(from, candidates, "down", { currentRegion: "here" })).toBe(
      1,
    );
    // without a region preference the nearer one wins
    expect(pickBest(from, candidates, "down")).toBe(0);
  });

  it("leaves the region when nothing in it lies in that direction", () => {
    const candidates: Candidate[] = [
      { rect: box(300, 0), region: "other" },
      { rect: box(0, -100), region: "here" },
    ];
    expect(
      pickBest(box(0, 0), candidates, "right", { currentRegion: "here" }),
    ).toBe(0);
  });

  it("leaves the region when a foreign candidate is much closer", () => {
    const candidates: Candidate[] = [
      { rect: box(0, 50), region: "other" },
      { rect: box(0, 2000), region: "here" },
    ];
    expect(
      pickBest(box(0, 0), candidates, "down", { currentRegion: "here" }),
    ).toBe(0);
  });

  it("breaks ties with the first candidate", () => {
    const candidates: Candidate[] = [
      { rect: box(0, 100) },
      { rect: box(0, 100) },
    ];
    expect(pickBest(box(0, 0), candidates, "down")).toBe(0);
  });
});

describe("pickFirst", () => {
  it("picks the topmost, then leftmost candidate", () => {
    const candidates: Candidate[] = [
      { rect: box(200, 100) },
      { rect: box(300, 0) },
      { rect: box(100, 0) },
    ];
    expect(pickFirst(candidates)).toBe(2);
  });

  it("skips candidates without an area and handles an empty list", () => {
    expect(pickFirst([])).toBe(-1);
    expect(pickFirst([{ rect: box(0, 0, 0, 0) }, { rect: box(5, 5) }])).toBe(1);
    expect(pickFirst([{ rect: box(0, 0, 0, 0) }])).toBe(-1);
  });
});

describe("nextRegion", () => {
  const order = ["servers", "channels", "messages", "members"];

  it("cycles forward and wraps around", () => {
    expect(nextRegion(order, "servers", order)).toBe("channels");
    expect(nextRegion(order, "members", order)).toBe("servers");
  });

  it("starts at the first region without a current one", () => {
    expect(nextRegion(order, undefined, order)).toBe("servers");
    expect(nextRegion(order, "unknown", order)).toBe("servers");
  });

  it("skips regions that aren't available", () => {
    expect(nextRegion(order, "servers", ["messages", "members"])).toBe(
      "messages",
    );
    expect(nextRegion(order, "messages", ["servers", "messages"])).toBe(
      "servers",
    );
  });

  it("stays in the only available region", () => {
    expect(nextRegion(order, "messages", ["messages"])).toBe("messages");
  });

  it("returns undefined when no region is available", () => {
    expect(nextRegion(order, "servers", [])).toBeUndefined();
  });
});
