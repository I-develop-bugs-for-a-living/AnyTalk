/** Position of the floating call window, top-left corner in viewport pixels */
export type Point = { x: number; y: number };

/** Size in pixels */
export type Size = { width: number; height: number };

/** Space the window must keep clear on each side, in pixels */
export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Gap between the window and the viewport edge */
export const WINDOW_MARGIN = 16;

/** Movement in pixels before a press becomes a drag */
export const DRAG_THRESHOLD = 4;

/** Distance from the top of the viewport of the default position, where the
 * window used to snap to (clears the channel header) */
export const DEFAULT_TOP = 72;

/** Distance in pixels an arrow key moves the window */
export const KEY_STEP = 16;

/**
 * Keep a value between a minimum and maximum; the minimum wins if the range
 * is empty (window bigger than the viewport).
 * @param value The value
 * @param min Lowest allowed
 * @param max Highest allowed
 * @returns The clamped value
 */
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Keep the window inside the viewport, clear of the insets plus a margin.
 * @param pos Wanted position
 * @param size Window size
 * @param viewport Viewport size
 * @param insets Space to keep clear (safe areas, title bar)
 * @param margin Gap to the edges
 * @returns A position inside the allowed area
 */
export function clampPosition(
  pos: Point,
  size: Size,
  viewport: Size,
  insets: Insets,
  margin = WINDOW_MARGIN,
): Point {
  const minX = insets.left + margin;
  const minY = insets.top + margin;
  const maxX = viewport.width - insets.right - margin - size.width;
  const maxY = viewport.height - insets.bottom - margin - size.height;
  return { x: clamp(pos.x, minX, maxX), y: clamp(pos.y, minY, maxY) };
}

/**
 * The position a window starts at: the top-right corner, below the header.
 * @param size Window size
 * @param viewport Viewport size
 * @param insets Space to keep clear
 * @param margin Gap to the edges
 * @returns The default position
 */
export function defaultPosition(
  size: Size,
  viewport: Size,
  insets: Insets,
  margin = WINDOW_MARGIN,
): Point {
  return clampPosition(
    { x: Infinity, y: DEFAULT_TOP },
    size,
    viewport,
    insets,
    margin,
  );
}

/**
 * Whether a pointer moved far enough from where it went down to count as a
 * drag instead of a click.
 * @param dx Horizontal distance
 * @param dy Vertical distance
 * @param threshold Distance that starts a drag
 * @returns True once the distance reaches the threshold
 */
export function passedDragThreshold(
  dx: number,
  dy: number,
  threshold = DRAG_THRESHOLD,
): boolean {
  return Math.hypot(dx, dy) >= threshold;
}

/**
 * Move a position by one arrow key press.
 * @param pos Current position
 * @param key The `KeyboardEvent.key`
 * @param step Distance to move
 * @returns The new position, or undefined if the key isn't an arrow key
 */
export function moveByKey(
  pos: Point,
  key: string,
  step = KEY_STEP,
): Point | undefined {
  switch (key) {
    case "ArrowLeft":
      return { x: pos.x - step, y: pos.y };
    case "ArrowRight":
      return { x: pos.x + step, y: pos.y };
    case "ArrowUp":
      return { x: pos.x, y: pos.y - step };
    case "ArrowDown":
      return { x: pos.x, y: pos.y + step };
    default:
      return undefined;
  }
}

/**
 * Read a saved position, ignoring anything that isn't two finite numbers.
 * @param raw The saved text
 * @returns The position, or undefined
 */
export function parseStoredPosition(raw: string | null): Point | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<Point> | null;
    if (
      value &&
      typeof value.x === "number" &&
      typeof value.y === "number" &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y)
    ) {
      return { x: value.x, y: value.y };
    }
  } catch {
    // broken data, use the default
  }
  return undefined;
}
