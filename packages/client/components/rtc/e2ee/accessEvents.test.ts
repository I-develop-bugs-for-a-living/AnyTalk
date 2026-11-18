import { describe, expect, it, vi } from "vitest";

import { type AccessEventSource, wireAccessEvents } from "./accessEvents";
import type { ChannelPolicy } from "./channelPolicy";

/** Minimal event emitter standing in for the Stoat client. */
function fakeClient() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const source: AccessEventSource = {
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event, handler) => void handlers.get(event)?.delete(handler),
  };
  return {
    source,
    emit: (event: string, ...args: unknown[]) =>
      handlers.get(event)?.forEach((h) => h(...args)),
    listeners: () =>
      [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

/** Fake policy that records calls. */
function fakePolicy() {
  return {
    allows: vi.fn(() => true),
    forget: vi.fn(),
    markLeft: vi.fn(),
  } satisfies ChannelPolicy;
}

describe("wireAccessEvents", () => {
  it("ignores other servers and channels, and handles members per user", () => {
    const client = fakeClient();
    const policy = fakePolicy();
    const reevaluate = vi.fn();
    wireAccessEvents(
      client.source,
      { channelId: "c1", serverId: "s1" },
      policy,
      reevaluate,
    );
    client.emit("serverMemberLeave", { id: { server: "other", user: "u" } });
    client.emit("serverRoleUpdate", { id: "other" }, "r");
    client.emit("channelUpdate", { id: "c2" });
    expect(reevaluate).not.toHaveBeenCalled();

    client.emit("serverMemberLeave", { id: { server: "s1", user: "u1" } });
    expect(policy.markLeft).toHaveBeenCalledWith("u1");
    expect(policy.forget).not.toHaveBeenCalled();
    client.emit("serverMemberJoin", { id: { server: "s1", user: "u2" } });
    expect(policy.forget).toHaveBeenCalledWith("u2");
    expect(policy.forget).toHaveBeenCalledTimes(1);
    client.emit("serverRoleUpdate", { id: "s1" }, "r");
    client.emit("channelUpdate", { id: "c1" });
    expect(reevaluate).toHaveBeenCalledTimes(4);
  });

  it("removes every listener when stopped", () => {
    const client = fakeClient();
    const reevaluate = vi.fn();
    const stop = wireAccessEvents(
      client.source,
      { channelId: "c1" },
      fakePolicy(),
      reevaluate,
    );
    expect(client.listeners()).toBeGreaterThan(0);
    stop();
    expect(client.listeners()).toBe(0);
    client.emit("channelUpdate", { id: "c1" });
    expect(reevaluate).not.toHaveBeenCalled();
  });

  it("handles DM and group calls (no server)", () => {
    const client = fakeClient();
    const reevaluate = vi.fn();
    wireAccessEvents(
      client.source,
      { channelId: "g1" },
      fakePolicy(),
      reevaluate,
    );
    client.emit("serverMemberLeave", { id: { server: "s", user: "u" } });
    client.emit("channelGroupLeave", { id: "g1" });
    expect(reevaluate).toHaveBeenCalledTimes(1);
  });
});
