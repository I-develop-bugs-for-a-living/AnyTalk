/**
 * Spatial navigation: choosing which element gets focus when a direction is
 * pressed. Everything here works on plain rectangles (screen coordinates), so
 * it needs no DOM and can be tested directly.
 */

/** Direction of a move, in screen terms (not reading direction) */
export type Direction = "up" | "down" | "left" | "right";

/** Rectangle in screen coordinates, like a DOMRect */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A focusable element's position and the region of the page it sits in */
export interface Candidate {
  rect: Rect;
  /** Landmark the element belongs to (servers, channels, main, ...) */
  region?: string;
}

/** Options for {@link pickBest} */
export interface PickOptions {
  /** Region of the element focus starts from */
  currentRegion?: string;
  /** Score multiplier for candidates outside the current region */
  foreignRegionPenalty?: number;
}

/**
 * Score multiplier for candidates outside the current region. Above 1 so
 * focus prefers to stay in a region, but still leaves it when nothing in the
 * region lies in that direction or a candidate elsewhere is much closer.
 */
export const FOREIGN_REGION_PENALTY = 2;

/** Weight of the sideways gap, so aligned elements beat diagonal ones */
const PERPENDICULAR_WEIGHT = 2;

/** Weight of the offset between centres across the move's axis */
const ALIGNMENT_WEIGHT = 0.25;

/**
 * Whether a rectangle has an area (elements without one aren't on screen)
 * @param rect Rectangle
 * @returns Boolean
 */
export function hasArea(rect: Rect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    rect.right > rect.left &&
    rect.bottom > rect.top
  );
}

/**
 * Whether a rectangle overlaps the viewport at all
 * @param rect Rectangle
 * @param width Viewport width
 * @param height Viewport height
 * @returns Boolean
 */
export function isInViewport(
  rect: Rect,
  width: number,
  height: number,
): boolean {
  return (
    rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height
  );
}

/**
 * Horizontal centre of a rectangle
 * @param rect Rectangle
 * @returns Coordinate
 */
function centerX(rect: Rect): number {
  return (rect.left + rect.right) / 2;
}

/**
 * Vertical centre of a rectangle
 * @param rect Rectangle
 * @returns Coordinate
 */
function centerY(rect: Rect): number {
  return (rect.top + rect.bottom) / 2;
}

/**
 * Whether a candidate lies in a direction from the starting rectangle. The
 * candidate has to reach past the starting rectangle's edge in that direction
 * and have its centre beyond the starting centre. This lets rectangles that
 * overlap partly count, while an element that merely sits inside the starting
 * one (or around it) doesn't.
 * @param from Rectangle focus starts from
 * @param to Candidate rectangle
 * @param direction Direction of the move
 * @returns Boolean
 */
export function isInDirection(
  from: Rect,
  to: Rect,
  direction: Direction,
): boolean {
  switch (direction) {
    case "up":
      return to.top < from.top && centerY(to) < centerY(from);
    case "down":
      return to.bottom > from.bottom && centerY(to) > centerY(from);
    case "left":
      return to.left < from.left && centerX(to) < centerX(from);
    case "right":
      return to.right > from.right && centerX(to) > centerX(from);
  }
}

/**
 * Size of the gap between two ranges, 0 when they overlap
 * @param aStart Start of the first range
 * @param aEnd End of the first range
 * @param bStart Start of the second range
 * @param bEnd End of the second range
 * @returns Gap
 */
function rangeGap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, bStart - aEnd, aStart - bEnd);
}

/**
 * How well a candidate fits a move, lower is better. It adds the distance
 * along the move's axis, the sideways gap (counted double) and a small share
 * of the offset between centres, so a neighbour in the same row or column
 * wins over a nearer one that sits diagonally.
 * @param from Rectangle focus starts from
 * @param to Candidate rectangle
 * @param direction Direction of the move
 * @returns Score, or Infinity when the candidate isn't in that direction
 */
export function scoreCandidate(
  from: Rect,
  to: Rect,
  direction: Direction,
): number {
  if (!isInDirection(from, to, direction)) return Infinity;

  const vertical = direction === "up" || direction === "down";

  // distance along the move's axis, from the near edge to the far edge
  const along = vertical
    ? rangeGap(from.top, from.bottom, to.top, to.bottom)
    : rangeGap(from.left, from.right, to.left, to.right);

  // sideways gap between the two (0 when they overlap in that axis)
  const across = vertical
    ? rangeGap(from.left, from.right, to.left, to.right)
    : rangeGap(from.top, from.bottom, to.top, to.bottom);

  const centreOffset = vertical
    ? Math.abs(centerX(to) - centerX(from))
    : Math.abs(centerY(to) - centerY(from));

  // tiny share of the distance between centres along the axis, which orders
  // candidates that overlap the start (along is 0 for all of them)
  const axisCentre = vertical
    ? Math.abs(centerY(to) - centerY(from))
    : Math.abs(centerX(to) - centerX(from));

  return (
    along +
    PERPENDICULAR_WEIGHT * across +
    ALIGNMENT_WEIGHT * centreOffset +
    0.01 * axisCentre
  );
}

/**
 * Pick the candidate to move focus to
 * @param from Rectangle focus starts from
 * @param candidates Focusable elements, without the one focus starts from
 * @param direction Direction of the move
 * @param options Region preference
 * @returns Index into candidates, or -1 when nothing lies in that direction
 */
export function pickBest(
  from: Rect,
  candidates: readonly Candidate[],
  direction: Direction,
  options: PickOptions = {},
): number {
  const penalty = options.foreignRegionPenalty ?? FOREIGN_REGION_PENALTY;

  let best = -1;
  let bestScore = Infinity;

  candidates.forEach((candidate, index) => {
    if (!hasArea(candidate.rect)) return;

    let score = scoreCandidate(from, candidate.rect, direction);
    if (!Number.isFinite(score)) return;

    if (
      options.currentRegion !== undefined &&
      candidate.region !== options.currentRegion
    ) {
      score *= penalty;
    }

    if (score < bestScore) {
      best = index;
      bestScore = score;
    }
  });

  return best;
}

/**
 * Pick the candidate that comes first in reading order (top to bottom, then
 * left to right). Used when nothing is focused yet.
 * @param candidates Focusable elements
 * @returns Index into candidates, or -1 when there are none
 */
export function pickFirst(candidates: readonly Candidate[]): number {
  let best = -1;

  candidates.forEach((candidate, index) => {
    if (!hasArea(candidate.rect)) return;
    if (best === -1) {
      best = index;
      return;
    }

    const current = candidates[best].rect;
    const rect = candidate.rect;
    if (
      rect.top < current.top ||
      (rect.top === current.top && rect.left < current.left)
    ) {
      best = index;
    }
  });

  return best;
}

/**
 * The region after the current one in a fixed order, skipping regions that
 * aren't on screen. Wraps around. Without a current region it starts at the
 * first one.
 * @param order All regions, in cycling order
 * @param current Region focus is in now
 * @param available Regions that can take focus right now
 * @returns Next region, or undefined when none is available
 */
export function nextRegion(
  order: readonly string[],
  current: string | undefined,
  available: readonly string[],
): string | undefined {
  const start = current === undefined ? -1 : order.indexOf(current);

  // a current region outside the order counts like no region
  for (let step = 1; step <= order.length; step++) {
    const region = order[(start + step + order.length) % order.length];
    if (available.includes(region)) return region;
  }

  return undefined;
}
