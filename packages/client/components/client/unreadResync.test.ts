import { afterEach, describe, expect, it, vi } from "vitest";

import type { Client } from "stoat.js";

// the real module pulls in the whole library; only the enum is needed
vi.mock("stoat.js", () => ({ ConnectionState: { Connected: 2 } }));

import {
  REFRESH_MIN_INTERVAL,
  RESYNC_LAG_DELAY,
  RESYNC_RETRY_DELAY,
  RESYNC_THROTTLE,
  autoResyncUnreads,
  newerMessageId,
  planUnreadUpdate,
} from "./unreadResync";

describe("planUnreadUpdate", () => {
  it("adds mentions that arrived while offline", () => {
    const plan = planUnreadUpdate(
      { lastMessageId: "01", mentions: [] },
      { last_id: "01", mentions: ["05"] },
    );
    expect(plan.addMentions).toEqual(["05"]);
    expect(plan.lastMessageId).toBeUndefined();
  });

  it("never moves the read position backwards", () => {
    const plan = planUnreadUpdate(
      { lastMessageId: "09", mentions: [] },
      { last_id: "03", mentions: ["05"] },
    );
    expect(plan.lastMessageId).toBeUndefined();
    expect(plan.addMentions).toEqual([]);
  });

  it("follows the server when it is ahead and drops read mentions", () => {
    const plan = planUnreadUpdate(
      { lastMessageId: "01", mentions: ["02"] },
      { last_id: "05", mentions: [] },
    );
    expect(plan.lastMessageId).toBe("05");
    expect(plan.removeMentions).toEqual(["02"]);
  });

  it("does not duplicate known mentions", () => {
    const plan = planUnreadUpdate(
      { mentions: ["07"] },
      { last_id: null, mentions: ["07", "08"] },
    );
    expect(plan.addMentions).toEqual(["08"]);
    expect(plan.removeMentions).toEqual([]);
  });

  it("ignores a mention equal to the local read position", () => {
    const plan = planUnreadUpdate(
      { lastMessageId: "05", mentions: [] },
      { last_id: "01", mentions: ["05"] },
    );
    expect(plan.addMentions).toEqual([]);
  });

  it("keeps a local mention the server still lists", () => {
    const plan = planUnreadUpdate(
      { lastMessageId: "01", mentions: ["02"] },
      { last_id: "05", mentions: ["02"] },
    );
    expect(plan.removeMentions).toEqual([]);
  });

  it("removes nothing when the server has no read position", () => {
    const plan = planUnreadUpdate(
      { lastMessageId: "05", mentions: ["06"] },
      { last_id: null, mentions: [] },
    );
    expect(plan.removeMentions).toEqual([]);
    expect(plan.lastMessageId).toBeUndefined();
  });

  it("compares real ULIDs by time", () => {
    const read = "01JAAAAAAAAAAAAAAAAAAAAAAA";
    const older = "01J0000000000000000000000A";
    const newer = "01JZZZZZZZZZZZZZZZZZZZZZZZ";
    expect(read).toHaveLength(26);
    const plan = planUnreadUpdate(
      { lastMessageId: read, mentions: [] },
      { last_id: older, mentions: [older, newer] },
    );
    expect(plan.addMentions).toEqual([newer]);
    expect(plan.lastMessageId).toBeUndefined();
  });
});

describe("autoResyncUnreads", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Fake client whose "ready" handler and fetch can be driven by the test
   */
  function fakeClient(get: () => Promise<unknown>) {
    let ready: () => void = () => {};
    const client = {
      on: (_event: string, handler: () => void) => (ready = handler),
      api: { get },
      channelUnreads: { get: () => undefined, getOrCreate: () => {} },
      channels: {
        get: () => undefined,
        toList: () => [],
        updateUnderlyingObject: vi.fn(),
      },
      servers: { toList: () => [{ id: "s1" }] },
      events: { state: () => 2 },
    };
    return { client: client as unknown as Client, ready: () => ready() };
  }

  it("fetches on every ready, including the first", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockResolvedValue([]);
    const { client, ready } = fakeClient(get);
    autoResyncUnreads(client);
    ready();
    expect(get).toHaveBeenCalledTimes(1);
    ready();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("throttles requested resyncs", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockResolvedValue([]);
    const { client } = fakeClient(get);
    const { request } = autoResyncUnreads(client);
    request();
    request();
    expect(get).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RESYNC_THROTTLE);
    request();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("retries once after a failed fetch and swallows the error", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockRejectedValue(new Error("offline"));
    const { client, ready } = fakeClient(get);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    autoResyncUnreads(client);
    ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_DELAY);
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_DELAY * 2);
    expect(get).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("runs one more full pass after the lag delay and replaces a pending one", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockResolvedValue([]);
    const { client, ready } = fakeClient(get);
    autoResyncUnreads(client);
    ready();
    await vi.advanceTimersByTimeAsync(RESYNC_LAG_DELAY - 1000);
    ready();
    await vi.advanceTimersByTimeAsync(RESYNC_LAG_DELAY - 1000);
    // two immediate runs, the first pass was replaced
    expect(get.mock.calls.filter((c) => c[0] === "/users/dms")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(get.mock.calls.filter((c) => c[0] === "/users/dms")).toHaveLength(1);
  });

  it("cancels the delayed pass", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockResolvedValue([]);
    const { client, ready } = fakeClient(get);
    const resyncer = autoResyncUnreads(client);
    ready();
    resyncer.cancel();
    await vi.advanceTimersByTimeAsync(RESYNC_LAG_DELAY * 2);
    expect(get.mock.calls.filter((c) => c[0] === "/users/dms")).toHaveLength(0);
  });

  it("cancel stops a pending retry", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockRejectedValue(new Error("offline"));
    const { client, ready } = fakeClient(get);
    const resyncer = autoResyncUnreads(client);
    ready();
    await vi.advanceTimersByTimeAsync(0);
    resyncer.cancel();
    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_DELAY * 2);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("skips the full refresh if the last one was under 60 s ago", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockResolvedValue([]);
    const { client, ready } = fakeClient(get);
    autoResyncUnreads(client);
    ready();
    await vi.advanceTimersByTimeAsync(RESYNC_LAG_DELAY);
    const dms = () => get.mock.calls.filter((c) => c[0] === "/users/dms");
    expect(dms()).toHaveLength(1);
    ready();
    await vi.advanceTimersByTimeAsync(RESYNC_LAG_DELAY);
    expect(dms()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(REFRESH_MIN_INTERVAL);
    ready();
    await vi.advanceTimersByTimeAsync(RESYNC_LAG_DELAY);
    expect(dms()).toHaveLength(2);
  });
});

describe("newerMessageId", () => {
  it("only moves forward", () => {
    expect(newerMessageId("05", "09")).toBe("09");
    expect(newerMessageId("09", "05")).toBeUndefined();
    expect(newerMessageId("05", "05")).toBeUndefined();
    expect(newerMessageId(undefined, "05")).toBe("05");
    expect(newerMessageId("05", null)).toBeUndefined();
  });
});
