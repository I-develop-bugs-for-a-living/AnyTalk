import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DISCONNECTED_GRACE_MS,
  createDisconnectedIndicator,
} from "./disconnectedIndicator";

/** Lifecycle state names used in these tests */
type StateName = "Connected" | "Reconnecting" | "Disconnected";

/** Build an indicator in its own root; effects start once the root is built */
function setup() {
  return createRoot((dispose) => {
    const [state, setState] = createSignal<StateName>("Connected");
    const shown = createDisconnectedIndicator(state);
    return { setState, shown, dispose };
  });
}

describe("createDisconnectedIndicator", () => {
  afterEach(() => vi.useRealTimers());

  it("shows only after the grace period and hides at once", () => {
    vi.useFakeTimers();
    const { setState, shown, dispose } = setup();
    expect(shown()).toBe(false);

    setState("Reconnecting");
    vi.advanceTimersByTime(DISCONNECTED_GRACE_MS - 1);
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(2);
    expect(shown()).toBe(true);

    setState("Connected");
    expect(shown()).toBe(false);
    dispose();
  });

  it("does not flash on a quick reconnect", () => {
    vi.useFakeTimers();
    const { setState, shown, dispose } = setup();
    setState("Disconnected");
    vi.advanceTimersByTime(1000);
    setState("Connected");
    vi.advanceTimersByTime(10_000);
    expect(shown()).toBe(false);
    dispose();
  });
});
