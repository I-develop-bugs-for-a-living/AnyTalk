/**
 * Pure math of zooming into a watched stream. A zoom is a scale and a
 * translation of the picture inside its frame, with the transform origin in
 * the frame's top-left corner: a point `p` of the picture lands at
 * `p * scale + translation`.
 */

/** Zoom state of one stream: scale (1 = fit) and translation in pixels */
export type StreamZoom = { scale: number; x: number; y: number };

/** Size of the frame the stream is drawn in, in pixels */
export type FrameSize = { width: number; height: number };

/** A point in the frame, in pixels from its top-left corner */
export type FramePoint = { x: number; y: number };

/** Not zoomed */
export const NO_ZOOM: StreamZoom = { scale: 1, x: 0, y: 0 };

/** Smallest zoom: the stream fits the frame */
export const MIN_SCALE = 1;
/** Largest zoom: 500% */
export const MAX_SCALE = 5;
/** Factor of the zoom buttons and keys */
export const BUTTON_STEP = 1.25;
/** Pixels the pointer must travel before a press counts as a drag */
export const DRAG_THRESHOLD = 4;

/** Below this the stream counts as not zoomed (float noise) */
const EPSILON = 0.001;

/**
 * Keep a scale inside the allowed range
 * @param scale Wanted scale
 */
export function clampScale(scale: number) {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Whether the stream is zoomed in
 * @param zoom Zoom state
 */
export function isZoomed(zoom: StreamZoom) {
  return zoom.scale > MIN_SCALE + EPSILON;
}

/**
 * Limit a zoom so the picture always covers the frame: at scale `s` the
 * translation can only go from `size * (1 - s)` to 0. Relative to the frame,
 * so the black bars of a letterboxed picture can be panned into view.
 * @param zoom Wanted zoom
 * @param size Frame size
 */
export function clampPan(zoom: StreamZoom, size: FrameSize): StreamZoom {
  const scale = clampScale(zoom.scale);
  if (scale <= MIN_SCALE + EPSILON) return NO_ZOOM;
  const clamp = (value: number, extent: number) =>
    Math.min(0, Math.max(extent * (1 - scale), value));
  return {
    scale,
    x: clamp(zoom.x, size.width),
    y: clamp(zoom.y, size.height),
  };
}

/**
 * Change the scale while the picture under `point` stays under it
 * @param zoom Current zoom
 * @param scale Wanted scale
 * @param point Where to zoom to, in the frame
 * @param size Frame size
 */
export function zoomAt(
  zoom: StreamZoom,
  scale: number,
  point: FramePoint,
  size: FrameSize,
): StreamZoom {
  const next = clampScale(scale);
  // the picture point under the cursor, before and after
  const px = (point.x - zoom.x) / zoom.scale;
  const py = (point.y - zoom.y) / zoom.scale;
  return clampPan(
    { scale: next, x: point.x - px * next, y: point.y - py * next },
    size,
  );
}

/** What a wheel event needs for its scale factor */
export type WheelLike = {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
};

/** Pixels per line, for mice that scroll by lines */
const LINE_PIXELS = 16;
/** Most pixels of one event that count, so one notch never jumps far */
const MAX_WHEEL_PIXELS = 120;
/** Scale change per wheel pixel */
const WHEEL_RATE = 0.0015;
/** Pinch gestures report small deltas, they need a stronger rate */
const PINCH_RATE = 0.01;

/**
 * Turn a wheel event into a multiplicative zoom factor (above 1 zooms in,
 * wheel up). Line and page deltas are converted to pixels.
 * @param e Wheel event
 * @param pageHeight Height in pixels of a page for page-wise scrolling
 */
export function wheelFactor(e: WheelLike, pageHeight: number) {
  const unit =
    e.deltaMode === 1 ? LINE_PIXELS : e.deltaMode === 2 ? pageHeight : 1;
  const pixels = Math.max(
    -MAX_WHEEL_PIXELS,
    Math.min(MAX_WHEEL_PIXELS, e.deltaY * unit),
  );
  return Math.exp(-pixels * (e.ctrlKey ? PINCH_RATE : WHEEL_RATE));
}

/**
 * Whether a pointer moved far enough from where it was pressed to be a drag
 * @param dx Horizontal distance in pixels
 * @param dy Vertical distance in pixels
 */
export function passedDragThreshold(dx: number, dy: number) {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}
