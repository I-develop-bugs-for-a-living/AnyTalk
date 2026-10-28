/** Movement (px) before a pull counts as a swipe, so taps and jitter don't drag */
export const SWIPE_DEAD_ZONE = 8;

/** Pull distance (px) that closes the phone profile page */
export const SWIPE_CLOSE_DISTANCE = 120;

/** Pull distance (px) that is enough when the swipe was quick */
export const SWIPE_CLOSE_FAST_DISTANCE = 60;

/** A swipe faster than this (px per ms) counts as quick */
export const SWIPE_CLOSE_VELOCITY = 0.5;

/**
 * Whether a vertical drag counts as a swipe-down gesture. It only counts when
 * the page was scrolled to the top when the drag started, so scrolling the
 * profile back up never closes it, and when the drag is mostly vertical.
 *
 * @param startScrollTop Scroll position when the touch started
 * @param deltaX Horizontal movement since the touch started
 * @param deltaY Vertical movement since the touch started (positive = down)
 */
export function isSwipeDown(
  startScrollTop: number,
  deltaX: number,
  deltaY: number,
): boolean {
  return (
    startScrollTop <= 0 && deltaY > SWIPE_DEAD_ZONE && deltaY > Math.abs(deltaX)
  );
}

/**
 * Whether a finished swipe-down should close the page: pulled far enough, or
 * a shorter but quick flick.
 *
 * @param deltaY Vertical distance of the drag in px
 * @param durationMs How long the drag took
 */
export function shouldCloseOnSwipe(
  deltaY: number,
  durationMs: number,
): boolean {
  if (deltaY >= SWIPE_CLOSE_DISTANCE) return true;
  return (
    deltaY >= SWIPE_CLOSE_FAST_DISTANCE &&
    durationMs > 0 &&
    deltaY / durationMs >= SWIPE_CLOSE_VELOCITY
  );
}
