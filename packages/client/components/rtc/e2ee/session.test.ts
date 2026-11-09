import { describe, expect, it } from "vitest";

import {
  type DeviceIdentity,
  generateCallKeyPair,
  generateIdentity,
  signHello,
} from "./crypto";
import {
  type Clock,
  type E2EEEvent,
  type PeerSnapshot,
  type PinStore,
  createMemoryPinStore,
  E2EESession,
  encodeHello,
  parseHello,
} from "./session";

/** Manual clock: timers run only when `advance` is called. */
function createClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

interface Sent {
  from: string;
  to: string[];
  topic: string;
  payload: Uint8Array;
}

/** A tiny in-memory room: attributes and messages between sessions. */
function createRoom() {
  const members = new Map<string, Node>();
  const log: Sent[] = [];
  /** When true, messages are queued instead of delivered. */
  let held: (() => void)[] | undefined;
  /** Sends from this identity throw while the count is above zero. */
  const failing = { from: "", count: 0 };
  /** Sends from this identity are silently lost while the count is above zero. */
  const dropping = { from: "", count: 0 };
  class Node {
    session!: E2EESession;
    hello?: string;
    keys: { identity: string; index: number; key: Uint8Array }[] = [];
    events: E2EEEvent[] = [];
    constructor(public id: string) {}
  }
  const room = {
    log,
    members,
    failing,
    dropping,
    hold() {
      held = [];
    },
    async release() {
      const queue = held ?? [];
      held = undefined;
      for (const run of queue) run();
      await settle();
    },
    async join(
      id: string,
      options: {
        identity: DeviceIdentity;
        pins?: PinStore;
        clock: Clock;
        callId?: string;
        skipHellos?: boolean;
        policy?: (peer: PeerSnapshot) => boolean;
      },
    ) {
      const node = new Node(id);
      members.set(id, node);
      node.session = new E2EESession({
        callId: options.callId ?? "call",
        selfId: id,
        identity: options.identity,
        pins: options.pins ?? createMemoryPinStore(),
        clock: options.clock,
        policy: options.policy,
        keySink: {
          setKey: async (key, identity, index) => {
            node.keys.push({ identity, index, key });
          },
        },
        transport: {
          getVisiblePeers: () => [...members.keys()].filter((m) => m !== id),
          publishHello: async (value) => {
            node.hello = value;
            for (const other of members.values()) {
              if (other !== node) void other.session.peerUpdated(id, value);
            }
          },
          sendData: async (payload, o) => {
            if (failing.count > 0 && failing.from === id) {
              failing.count--;
              throw new Error("network down");
            }
            if (dropping.count > 0 && dropping.from === id) {
              dropping.count--;
              return;
            }
            log.push({
              from: id,
              to: o.destinationIdentities,
              topic: o.topic,
              payload,
            });
            for (const to of o.destinationIdentities) {
              const target = members.get(to);
              const deliver = () =>
                void target?.session.handleData(id, o.topic, payload);
              if (held) held.push(deliver);
              else deliver();
            }
          },
        },
      });
      node.session.onEvent((e) => node.events.push(e));
      await node.session.start();
      // announce existing members both ways
      for (const other of members.values()) {
        if (other === node) continue;
        if (other.hello && !options.skipHellos)
          void node.session.peerUpdated(other.id, other.hello);
      }
      await settle();
      return node;
    },
    async leave(id: string) {
      members.delete(id);
      for (const other of members.values()) void other.session.peerLeft(id);
      await settle();
    },
  };
  return room;
}

/** Builds a valid hello attribute for `userId` signed by `identity`. */
async function helloFor(userId: string, identity: DeviceIdentity) {
  const call = await generateCallKeyPair();
  return encodeHello({
    callPublicKey: call.publicRaw,
    signature: await signHello(
      identity.privateKey,
      "call",
      userId,
      call.publicRaw,
    ),
    identityPublicKey: identity.publicRaw,
  });
}

/** Lets queued async work (crypto, microtasks) finish. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
}

describe("hello encoding", () => {
  it("round trips and rejects garbage", async () => {
    const id = await generateIdentity();
    const hello = {
      callPublicKey: id.publicRaw,
      signature: new Uint8Array(64),
      identityPublicKey: id.publicRaw,
    };
    expect(parseHello(encodeHello(hello))?.callPublicKey).toEqual(id.publicRaw);
    expect(parseHello("nope")).toBeUndefined();
    expect(parseHello(undefined)).toBeUndefined();
    expect(parseHello(JSON.stringify({ v: 2 }))).toBeUndefined();
    expect(
      parseHello(JSON.stringify({ v: 1, k: "AA", s: "AA", i: "AA" })),
    ).toBeUndefined();
  });
});

describe("E2EESession", () => {
  it("exchanges keys between two visible peers", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    const b = await room.join("bob", {
      identity: await generateIdentity(),
      clock,
    });
    await settle();
    expect(a.keys.some((k) => k.identity === "bob")).toBe(true);
    expect(b.keys.some((k) => k.identity === "alice")).toBe(true);
    const own = a.keys.find((k) => k.identity === "alice")!;
    expect(b.keys.find((k) => k.identity === "alice")!.key).toEqual(own.key);
    expect(a.session.getPeer("bob")?.trust).toBe("new");
    // every key message is addressed to exactly one recipient
    for (const m of room.log) expect(m.to.length).toBe(1);
  });

  it("never sends keys to a peer that is not visible", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    const ghost = await generateIdentity();
    const b = await room.join("ghost", { identity: ghost, clock });
    room.members.delete("ghost"); // hidden: not in the roster any more
    await a.session.peerUpdated("ghost", b.hello);
    const before = room.log.length;
    await a.session.peerUpdated("ghost", b.hello);
    expect(room.log.length).toBe(before);
  });

  it("rotates on leave and switches after acks", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    await room.join("bob", { identity: await generateIdentity(), clock });
    const c = await room.join("carol", {
      identity: await generateIdentity(),
      clock,
    });
    await settle();
    await room.leave("bob");
    const ownKeys = a.keys.filter((k) => k.identity === "alice");
    expect(ownKeys.map((k) => k.index)).toEqual([0, 1]);
    expect(ownKeys[1].key).not.toEqual(ownKeys[0].key);
    // carol received the new key
    const carolView = c.keys.filter((k) => k.identity === "alice");
    expect(carolView.at(-1)!.index).toBe(1);
    expect(carolView.at(-1)!.key).toEqual(ownKeys[1].key);
  });

  it("switches after the grace period when acks are missing", async () => {
    const t = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    await room.join("bob", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    await room.join("carol", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    await settle();
    room.hold(); // acks (and wraps) are not delivered
    room.members.delete("bob");
    void a.session.peerLeft("bob");
    await settle();
    expect(a.keys.filter((k) => k.identity === "alice").length).toBe(1);
    t.advance(300);
    await settle();
    expect(a.keys.filter((k) => k.identity === "alice").length).toBe(2);
  });

  it("drops replayed, stale and misaddressed messages", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    const b = await room.join("bob", {
      identity: await generateIdentity(),
      clock,
    });
    await settle();
    const wrap = room.log.find(
      (m) =>
        m.from === "alice" &&
        JSON.parse(new TextDecoder().decode(m.payload)).t === "wrap",
    )!;
    const count = b.keys.length;
    await b.session.handleData("alice", wrap.topic, wrap.payload); // replay
    expect(b.keys.length).toBe(count);
    // same payload claimed by another sender or another topic
    await b.session.handleData("mallory", wrap.topic, wrap.payload);
    await b.session.handleData("alice", "other", wrap.payload);
    expect(b.keys.length).toBe(count);
    expect(a.session.getPeer("bob")).toBeDefined();
  });

  it("pins keys: second call is pinned, additional device is new, locked mismatch is changed", async () => {
    const { clock } = createClock();
    const pins = createMemoryPinStore();
    const aliceId = await generateIdentity();
    const room1 = createRoom();
    await room1.join("alice", { identity: aliceId, clock });
    const b1 = await room1.join("bob", {
      identity: await generateIdentity(),
      clock,
      pins,
    });
    expect(b1.session.getPeer("alice")?.trust).toBe("new");

    const room2 = createRoom();
    await room2.join("alice", { identity: aliceId, clock });
    const b2 = await room2.join("bob", {
      identity: await generateIdentity(),
      clock,
      pins,
    });
    expect(b2.session.getPeer("alice")?.trust).toBe("pinned");

    const room3 = createRoom();
    await room3.join("alice", { identity: await generateIdentity(), clock });
    const b3 = await room3.join("bob", {
      identity: await generateIdentity(),
      clock,
      pins,
    });
    expect(b3.session.getPeer("alice")?.trust).toBe("new");
    expect(
      b3.events.some(
        (e) => e.type === "identity-changed" && e.additionalDevice,
      ),
    ).toBe(true);
    expect(pins.list("alice").length).toBe(2);

    pins.add("alice", { fingerprint: "locked", locked: true });
    const room4 = createRoom();
    const a4 = await room4.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    const b4 = await room4.join("bob", {
      identity: await generateIdentity(),
      clock,
      pins,
    });
    expect(b4.session.getPeer("alice")?.trust).toBe("changed");
    // changed never blocks in automatic mode
    expect(b4.keys.some((k) => k.identity === "alice")).toBe(true);
    expect(a4.keys.some((k) => k.identity === "bob")).toBe(true);
  });

  it("refuses on a bad hello and on a downgrade report, but only waits for a missing hello", async () => {
    const t = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    const b = await room.join("bob", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    await settle();

    const forged = JSON.parse(b.hello!);
    room.members.set("eve", b);
    await a.session.peerUpdated(
      "eve",
      JSON.stringify({ ...forged, s: "A".repeat(86) }),
    );
    expect(a.session.getPeer("eve")?.trust).toBe("unencrypted");
    expect(a.keys.some((k) => k.identity === "eve")).toBe(false);

    room.members.set("dan", b);
    await a.session.peerUpdated("dan", undefined);
    t.advance(5000);
    await settle();
    expect(a.session.getPeer("dan")?.trust).toBe("pending");
    expect(a.session.getPeer("dan")?.helloTimedOut).toBe(true);

    expect(a.session.reportUnencryptedTrack("bob", "t1")).toEqual({
      refuse: true,
    });
    expect(a.session.getPeer("bob")?.trust).toBe("unencrypted");
    // non-visible identities never create peers
    a.session.reportUnencryptedTrack("nobody", "t9");
    expect(a.session.getPeer("nobody")).toBeUndefined();
  });

  it("recovers a pending peer when a late valid hello arrives", async () => {
    const t = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    room.members.set("dan", a); // visible stand-in
    await a.session.peerUpdated("dan", undefined);
    t.advance(5000);
    await settle();
    expect(a.session.getPeer("dan")?.helloTimedOut).toBe(true);
    const hello = await helloFor("dan", await generateIdentity());
    await a.session.peerUpdated("dan", hello);
    expect(a.session.getPeer("dan")?.trust).toBe("new");
    expect(a.session.getPeer("dan")?.helloTimedOut).toBe(false);
    // a reported plaintext track outlives later hellos, until it is cleared
    a.session.reportUnencryptedTrack("dan", "t1");
    await a.session.peerUpdated(
      "dan",
      await helloFor("dan", await generateIdentity()),
    );
    expect(a.session.getPeer("dan")?.trust).toBe("unencrypted");
    a.session.clearUnencryptedTrack("dan", "t1");
    expect(a.session.getPeer("dan")?.trust).toBe("changed");
  });

  it("does not reset replay state for a malleated hello with the same keys", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    const b = await room.join("bob", {
      identity: await generateIdentity(),
      clock,
    });
    await settle();
    const wrap = room.log.find(
      (m) =>
        m.from === "bob" &&
        JSON.parse(new TextDecoder().decode(m.payload)).t === "wrap",
    )!;
    const count = a.keys.length;
    const malleated = JSON.stringify({ ...JSON.parse(b.hello!), extra: 1 });
    await a.session.peerUpdated("bob", malleated);
    await a.session.handleData("bob", wrap.topic, wrap.payload); // replay
    expect(a.keys.length).toBe(count);
  });

  it("sends no keys after the identity swaps mid-call", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    await room.join("bob", { identity: await generateIdentity(), clock });
    await settle();
    const before = room.log.filter((m) => m.from === "alice").length;
    await a.session.peerUpdated(
      "bob",
      await helloFor("bob", await generateIdentity()),
    );
    expect(a.session.getPeer("bob")?.trust).toBe("changed");
    expect(a.events.some((e) => e.type === "identity-changed")).toBe(true);
    await a.session.reevaluate();
    await settle();
    // the key holder was demoted, so alice rotated without sending to bob
    expect(room.log.filter((m) => m.from === "alice").length).toBe(before);
    expect(a.keys.filter((k) => k.identity === "alice").length).toBe(2);
  });

  it("rotates when a key holder is demoted", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    await room.join("bob", { identity: await generateIdentity(), clock });
    const c = await room.join("carol", {
      identity: await generateIdentity(),
      clock,
    });
    await settle();
    a.session.reportUnencryptedTrack("bob", "t1");
    await settle();
    const own = a.keys.filter((k) => k.identity === "alice");
    expect(own.map((k) => k.index)).toEqual([0, 1]);
    expect(c.keys.filter((k) => k.identity === "alice").at(-1)!.index).toBe(1);
  });

  it("keeps a failed send retryable", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    room.failing.from = "alice";
    room.failing.count = 1;
    const b = await room.join("bob", {
      identity: await generateIdentity(),
      clock,
    });
    await settle();
    expect(a.session.getPeer("bob")?.keySent).toBe(false);
    expect(b.keys.some((k) => k.identity === "alice")).toBe(false);
    await a.session.reevaluate();
    await settle();
    expect(a.session.getPeer("bob")?.keySent).toBe(true);
    expect(b.keys.some((k) => k.identity === "alice")).toBe(true);
  });

  it("recovers a lost initial wrap through a key request", async () => {
    const t = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    room.dropping.from = "alice";
    room.dropping.count = 1; // alice's first wrap to bob is lost
    const b = await room.join("bob", {
      identity: await generateIdentity(),
      clock: t.clock,
    });
    await settle();
    expect(b.keys.some((k) => k.identity === "alice")).toBe(false);
    t.advance(3000); // bob asks alice for the key
    await settle();
    expect(b.keys.some((k) => k.identity === "alice")).toBe(true);
    expect(a.session.getPeer("bob")?.keySent).toBe(true);
  });

  it("replays a wrap that arrived before the hello", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    const c = await room.join("carol", {
      identity: await generateIdentity(),
      clock,
      skipHellos: true,
    });
    await settle();
    // alice sent carol a wrap, but carol did not know alice's hello yet
    expect(c.keys.some((k) => k.identity === "alice")).toBe(false);
    await c.session.peerUpdated("alice", a.hello);
    await settle();
    expect(c.keys.some((k) => k.identity === "alice")).toBe(true);
  });

  it("resends all keys on request after a reconnect", async () => {
    const { clock } = createClock();
    const room = createRoom();
    const a = await room.join("alice", {
      identity: await generateIdentity(),
      clock,
    });
    await room.join("bob", { identity: await generateIdentity(), clock });
    await settle();
    const before = room.log.filter((m) => m.from === "alice").length;
    await a.session.resendAll();
    await settle();
    expect(room.log.filter((m) => m.from === "alice").length).toBeGreaterThan(
      before,
    );
  });

  it("honors the trust policy hook", async () => {
    const { clock } = createClock();
    const room = createRoom();
    await room.join("alice", { identity: await generateIdentity(), clock });
    const b = await room.join("bob", {
      identity: await generateIdentity(),
      clock,
      policy: () => false,
    });
    expect(b.keys.some((k) => k.identity === "alice")).toBe(false);
    expect(room.log.some((m) => m.from === "bob")).toBe(false);
  });
});
