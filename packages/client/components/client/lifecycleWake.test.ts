import { describe, expect, it } from "vitest";

import {
  HIDDEN_DROP_AFTER_MS,
  actionOnOffline,
  actionOnVisible,
  actionOnWake,
} from "./lifecycleWake";

describe("actionOnWake", () => {
  it("retries now while waiting on the backoff timer", () => {
    expect(actionOnWake("Disconnected", true)).toBe("retry");
  });

  it("leaves the offline state when back online", () => {
    expect(actionOnWake("Offline", true)).toBe("deviceOnline");
  });

  it("does nothing while still offline", () => {
    expect(actionOnWake("Disconnected", false)).toBeUndefined();
    expect(actionOnWake("Offline", false)).toBeUndefined();
  });

  it("never opens a second connection", () => {
    for (const state of [
      "Connecting",
      "Reconnecting",
      "Connected",
      "Ready",
    ] as const) {
      expect(actionOnWake(state, true)).toBeUndefined();
    }
  });
});

describe("actionOnOffline", () => {
  it("drops the socket only while connecting or connected", () => {
    expect(actionOnOffline("Connected")).toBe("dropSocket");
    expect(actionOnOffline("Connecting")).toBe("dropSocket");
    expect(actionOnOffline("Reconnecting")).toBe("dropSocket");
    expect(actionOnOffline("Disconnected")).toBeUndefined();
    expect(actionOnOffline("Offline")).toBeUndefined();
  });
});

describe("actionOnVisible", () => {
  it("drops a connected socket after a long time hidden", () => {
    expect(actionOnVisible("Connected", HIDDEN_DROP_AFTER_MS + 1)).toBe(
      "dropSocket",
    );
  });

  it("keeps the socket after a short time hidden", () => {
    expect(actionOnVisible("Connected", HIDDEN_DROP_AFTER_MS)).toBeUndefined();
  });

  it("ignores other states", () => {
    expect(actionOnVisible("Disconnected", 60_000)).toBeUndefined();
  });
});
