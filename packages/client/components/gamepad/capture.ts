import { createSignal } from "solid-js";

import type { PressButton } from "./input";

const [gamepadCapturing, setGamepadCapturing] = createSignal(false);

/**
 * Whether the settings page is waiting for a button to rebind. While true the
 * controller must not drive the app, so the captured press does nothing else.
 */
export { gamepadCapturing, setGamepadCapturing };

/** How long to wait for a button before giving up, in milliseconds */
export const CAPTURE_TIMEOUT_MS = 10_000;

/** What a capture poll found */
export type CaptureResult =
  | { kind: "waiting" }
  | { kind: "captured"; button: PressButton }
  | { kind: "timeout" };

/**
 * Picks the first button pressed after everything was let go. Buttons held
 * when it starts (the press that opened the recorder) are ignored until
 * released. No timers or DOM, the caller passes the time.
 */
export class ButtonCapture {
  private released = false;
  private startedAt: number | null = null;

  /**
   * @param timeout Time to wait in milliseconds
   */
  constructor(private readonly timeout = CAPTURE_TIMEOUT_MS) {}

  /**
   * Feed the buttons held right now
   * @param held Names of the held buttons, across all controllers
   * @param now Current time in milliseconds
   * @returns The capture state
   */
  poll(held: readonly PressButton[], now: number): CaptureResult {
    this.startedAt ??= now;
    if (now - this.startedAt >= this.timeout) return { kind: "timeout" };

    if (!this.released) {
      if (held.length === 0) this.released = true;
      return { kind: "waiting" };
    }

    if (held.length > 0) return { kind: "captured", button: held[0] };
    return { kind: "waiting" };
  }
}
