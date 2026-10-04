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
