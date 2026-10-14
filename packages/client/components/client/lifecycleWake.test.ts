import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HIDDEN_DROP_AFTER_MS,
  actionOnOffline,
  actionOnVisible,
  actionOnWake,
  probeSocket,
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
  it("probes a connected socket after a long time hidden", () => {
    expect(actionOnVisible("Connected", HIDDEN_DROP_AFTER_MS + 1)).toBe(
      "probeSocket",
    );
  });

  it("keeps the socket after a short time hidden", () => {
    expect(actionOnVisible("Connected", HIDDEN_DROP_AFTER_MS)).toBeUndefined();
  });

  it("ignores other states", () => {
    expect(actionOnVisible("Disconnected", 60_000)).toBeUndefined();
  });
});

describe("probeSocket", () => {
  /** Fake event client that records calls */
  function makeTarget() {
    const handled: unknown[] = [];
    return {
      handled,
      sent: [] as { type: "Ping"; data: number }[],
      disconnected: 0,
      send(event: { type: "Ping"; data: number }) {
        this.sent.push(event);
      },
      handle(event: { type: string; data?: unknown }) {
        handled.push(event);
      },
      disconnect() {
        this.disconnected++;
      },
    };
  }

  afterEach(() => vi.useRealTimers());

  it("keeps the socket when the matching Pong arrives", () => {
    vi.useFakeTimers();
    const target = makeTarget();
    probeSocket(target, 3000, () => 42);
    expect(target.sent).toHaveLength(1);
    target.handle({ type: "Pong", data: target.sent[0].data });
    vi.advanceTimersByTime(5000);
    expect(target.disconnected).toBe(0);
    expect(target.handled).toHaveLength(1);
  });

  it("ignores a Pong with another token", () => {
    vi.useFakeTimers();
    const target = makeTarget();
    probeSocket(target, 3000, () => 42);
    target.handle({ type: "Pong", data: 7 });
    vi.advanceTimersByTime(3001);
    expect(target.disconnected).toBe(1);
  });

  it("cancel restores handle and never disconnects", () => {
    vi.useFakeTimers();
    const target = makeTarget();
    const original = target.handle;
    const cancel = probeSocket(target, 3000, () => 42);
    expect(target.handle).not.toBe(original);
    cancel();
    expect(target.handle).toBe(original);
    vi.advanceTimersByTime(5000);
    expect(target.disconnected).toBe(0);
  });

  it("closes the socket when no Pong arrives", () => {
    vi.useFakeTimers();
    const target = makeTarget();
    probeSocket(target, 3000, () => 42);
    vi.advanceTimersByTime(3001);
    expect(target.disconnected).toBe(1);
  });

  it("closes the socket when the Ping cannot be sent", () => {
    const target = makeTarget();
    target.send = () => {
      throw "Socket closed";
    };
    probeSocket(target, 3000, () => 1);
    expect(target.disconnected).toBe(1);
  });
});
