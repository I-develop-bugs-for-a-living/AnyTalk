import { describe, expect, it, vi } from "vitest";

import {
  type ServerAccess,
  ERROR_RETRY_MS,
  LEFT_HOLD_MS,
  MISSING_RETRY_MS,
  createChannelPolicy,
  isNotAMemberError,
} from "./channelPolicy";

/** A fake server channel: members with a Connect flag, fetch results by user. */
function serverAccess(
  members: Map<string, { connect: boolean }>,
  fetchMember: ServerAccess<{ connect: boolean }>["fetchMember"],
  ownerId = "owner",
): ServerAccess<{ connect: boolean }> {
  return {
    kind: "server",
    ownerId: () => ownerId,
    getMember: (id) => members.get(id),
    fetchMember,
    canConnect: (m) => m.connect,
  };
}

/** Lets promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createChannelPolicy: server channels", () => {
  it("allows members with Connect and the owner, denies a member without it", () => {
    const members = new Map([
      ["alice", { connect: true }],
      ["bob", { connect: false }],
    ]);
    const policy = createChannelPolicy(
      serverAccess(members, () => Promise.resolve()),
      () => {},
    );
    expect(policy.allows("alice")).toBe(true);
    expect(policy.allows("bob")).toBe(false);
    expect(policy.allows("owner")).toBe(true);
  });

  it("treats an unloaded member as pending, fetches once and calls onChange", async () => {
    const members = new Map<string, { connect: boolean }>();
    const fetchMember = vi.fn(async (id: string) => {
      await Promise.resolve();
      members.set(id, { connect: true });
    });
    const onChange = vi.fn();
    const policy = createChannelPolicy(
      serverAccess(members, fetchMember),
      onChange,
    );
    expect(policy.allows("carol")).toBe(false);
    expect(policy.allows("carol")).toBe(false);
    expect(fetchMember).toHaveBeenCalledTimes(1);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(policy.allows("carol")).toBe(true);
  });

  it("denies someone who is not a member and retries only after a while", async () => {
    let time = 0;
    const fetchMember = vi.fn(() => Promise.reject({ type: "NotFound" }));
    const onChange = vi.fn();
    const policy = createChannelPolicy(
      serverAccess(new Map(), fetchMember),
      onChange,
      () => time,
    );
    expect(policy.allows("kicked")).toBe(false);
    await flush();
    expect(policy.allows("kicked")).toBe(false);
    expect(fetchMember).toHaveBeenCalledTimes(1);
    time = MISSING_RETRY_MS + 1;
    expect(policy.allows("kicked")).toBe(false);
    expect(fetchMember).toHaveBeenCalledTimes(2);
    // forget() allows an immediate new lookup (e.g. after a member joined)
    await flush();
    policy.forget("kicked");
    policy.allows("kicked");
    expect(fetchMember).toHaveBeenCalledTimes(3);
  });

  it("backs off a few seconds after a failed request that is not a 'not a member' answer", async () => {
    let time = 0;
    const fetchMember = vi.fn(() => Promise.reject(new Error("offline")));
    const policy = createChannelPolicy(
      serverAccess(new Map(), fetchMember),
      () => {},
      () => time,
    );
    policy.allows("dave");
    await flush();
    policy.allows("dave");
    expect(fetchMember).toHaveBeenCalledTimes(1);
    time = ERROR_RETRY_MS;
    policy.allows("dave");
    expect(fetchMember).toHaveBeenCalledTimes(2);
  });

  it("keeps a user who left denied, even while the cache still has them", () => {
    let time = 0;
    const members = new Map([["alice", { connect: true }]]);
    const policy = createChannelPolicy(
      serverAccess(members, () => Promise.resolve()),
      () => {},
      () => time,
    );
    policy.markLeft("alice");
    expect(policy.allows("alice")).toBe(false);
    policy.forget("alice"); // joined again
    expect(policy.allows("alice")).toBe(true);
    policy.markLeft("alice");
    time = LEFT_HOLD_MS;
    expect(policy.allows("alice")).toBe(true);
  });

  it("ignores a lookup that finishes after the user left", async () => {
    const members = new Map<string, { connect: boolean }>();
    const onChange = vi.fn();
    const policy = createChannelPolicy(
      serverAccess(members, async (id) => {
        await Promise.resolve();
        members.set(id, { connect: true });
      }),
      onChange,
    );
    policy.allows("eve");
    policy.markLeft("eve");
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(policy.allows("eve")).toBe(false);
  });

  it("denies when the permission check throws", () => {
    const policy = createChannelPolicy(
      {
        ...serverAccess(new Map([["x", { connect: true }]]), async () => {}),
        canConnect: () => {
          throw new Error("boom");
        },
      },
      () => {},
    );
    expect(policy.allows("x")).toBe(false);
  });
});

describe("createChannelPolicy: DM and group calls", () => {
  it("allows only recipients", () => {
    const policy = createChannelPolicy(
      { kind: "recipients", isRecipient: (id) => id === "alice" },
      () => {},
    );
    expect(policy.allows("alice")).toBe(true);
    expect(policy.allows("mallory")).toBe(false);
  });
});

describe("isNotAMemberError", () => {
  it("recognises API errors", () => {
    expect(isNotAMemberError({ type: "NotFound" })).toBe(true);
    expect(isNotAMemberError({ type: "InternalError" })).toBe(false);
    expect(isNotAMemberError(new Error("x"))).toBe(false);
    expect(isNotAMemberError(undefined)).toBe(false);
  });
});
