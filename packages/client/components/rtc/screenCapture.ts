/**
 * Largest screen capture we may ask for, set from the server's limits
 *
 * The capture is opened at this size and frame rate, and the chosen quality
 * only ever scales it down. Asking a running capture for more than it was
 * opened with restarts it, which on Linux (PipeWire) shows the system's
 * screen picker again and streams whatever is picked there.
 */
let captureLimit = { width: 1280, height: 720, frameRate: 60 };

export function setScreenCaptureLimit(limit: typeof captureLimit) {
  captureLimit = limit;
}

export function screenCaptureLimit() {
  return captureLimit;
}

/** Whether the next capture must leave the browser focus where it is */
let keepFocusOnCapture = false;

/**
 * Ask that the next screen capture does not switch to the captured tab or
 * window. Browsers do that by default as soon as the picker is confirmed,
 * which would pull the user away while they still choose the stream quality.
 * It only applies to the next capture, and only where the browser supports
 * the Capture Controller API (Chromium).
 */
export function setScreenCaptureKeepFocus(keep: boolean) {
  keepFocusOnCapture = keep;
}

/** Read and reset the request made with `setScreenCaptureKeepFocus` */
export function takeScreenCaptureKeepFocus() {
  const keep = keepFocusOnCapture;
  keepFocusOnCapture = false;
  return keep;
}
