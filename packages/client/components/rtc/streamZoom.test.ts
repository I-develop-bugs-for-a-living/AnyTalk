import { describe, expect, it } from "vitest";

import {
  clampPan,
  clampScale,
  MAX_SCALE,
  NO_ZOOM,
  passedDragThreshold,
  wheelFactor,
  zoomAt,
} from "./streamZoom";

const size = { width: 800, height: 400 };

describe("clampScale", () => {
  it("keeps the scale between 100% and 500%", () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(3)).toBe(3);
    expect(clampScale(50)).toBe(MAX_SCALE);
    expect(clampScale(NaN)).toBe(1);
  });
});

describe("clampPan", () => {
  it("drops the translation when not zoomed", () => {
    expect(clampPan({ scale: 1, x: -50, y: 20 }, size)).toEqual(NO_ZOOM);
  });

  it("keeps the picture covering the frame", () => {
    expect(clampPan({ scale: 2, x: 30, y: 30 }, size)).toEqual({
      scale: 2,
      x: 0,
      y: 0,
    });
    expect(clampPan({ scale: 2, x: -5000, y: -5000 }, size)).toEqual({
      scale: 2,
      x: -800,
      y: -400,
    });
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor in place", () => {
    const next = zoomAt(NO_ZOOM, 2, { x: 400, y: 200 }, size);
    expect(next.scale).toBe(2);
    // the centre of the picture is still at the centre of the frame
    expect(400 * next.scale + next.x).toBeCloseTo(400);
    expect(next.x).toBe(-400);
  });

  it("zooms toward a corner without leaving the frame", () => {
    const next = zoomAt(NO_ZOOM, 2, { x: 0, y: 0 }, size);
    expect(next).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it("zooms back out to fit", () => {
    const zoomed = zoomAt(NO_ZOOM, 3, { x: 100, y: 100 }, size);
    expect(zoomAt(zoomed, 1, { x: 100, y: 100 }, size)).toEqual(NO_ZOOM);
  });

  it("never goes past 500%", () => {
    expect(zoomAt(NO_ZOOM, 99, { x: 10, y: 10 }, size).scale).toBe(MAX_SCALE);
  });
});

describe("wheelFactor", () => {
  it("zooms in on wheel up and out on wheel down", () => {
    expect(
      wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }, 600),
    ).toBeGreaterThan(1);
    expect(
      wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false }, 600),
    ).toBeLessThan(1);
  });

  it("treats lines like pixels", () => {
    const lines = wheelFactor(
      { deltaY: -3, deltaMode: 1, ctrlKey: false },
      600,
    );
    const pixels = wheelFactor(
      { deltaY: -48, deltaMode: 0, ctrlKey: false },
      600,
    );
    expect(lines).toBeCloseTo(pixels);
  });

  it("limits what one event can do", () => {
    const big = wheelFactor(
      { deltaY: -100000, deltaMode: 0, ctrlKey: false },
      600,
    );
    const cap = wheelFactor(
      { deltaY: -120, deltaMode: 0, ctrlKey: false },
      600,
    );
    expect(big).toBeCloseTo(cap);
  });

  it("pinch gestures zoom faster per pixel", () => {
    const pinch = wheelFactor({ deltaY: -5, deltaMode: 0, ctrlKey: true }, 600);
    const wheel = wheelFactor(
      { deltaY: -5, deltaMode: 0, ctrlKey: false },
      600,
    );
    expect(pinch).toBeGreaterThan(wheel);
  });
});

describe("passedDragThreshold", () => {
  it("needs a few pixels of travel", () => {
    expect(passedDragThreshold(1, 1)).toBe(false);
    expect(passedDragThreshold(3, 3)).toBe(true);
  });
});
