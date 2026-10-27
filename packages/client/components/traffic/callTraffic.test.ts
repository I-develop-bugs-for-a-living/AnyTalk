import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CallRoomLike,
  type StatsRecord,
  bytesKey,
  connectionKey,
  describePayload,
  monitorCall,
  parseBytes,
  parseConnection,
  statsToRecords,
} from "./callTraffic";
import { TrafficRecorder } from "./recorder";
import { REDACTED, redactEntry } from "./redact";
import type { TrafficEntry } from "./types";

/** A stats report with the pieces of a relayed connection. */
const reports = (bytes = 100): StatsRecord[] => [
  {
    id: "T1",
    type: "transport",
    selectedCandidatePairId: "P1",
    dtlsState: "connected",
    dtlsCipher: "TLS_AES_128_GCM_SHA256",
    srtpCipher: "AEAD_AES_128_GCM",
    tlsVersion: "FEFD",
    bytesSent: bytes,
    bytesReceived: 5,
  },
  {
    id: "P1",
    type: "candidate-pair",
    localCandidateId: "L1",
    remoteCandidateId: "R1",
  },
  {
    id: "L1",
    type: "local-candidate",
    candidateType: "relay",
    protocol: "udp",
    relayProtocol: "tls",
    url: "turn:turn.example.com:443",
    networkType: "wifi",
  },
  {
    id: "R1",
    type: "remote-candidate",
    candidateType: "host",
    address: "203.0.113.5",
    port: 50000,
  },
  { id: "O1", type: "outbound-rtp", kind: "video", mid: "1", bytesSent: 10 },
  { id: "O2", type: "outbound-rtp", kind: "video", mid: "1", bytesSent: 20 },
  { id: "I1", type: "inbound-rtp", kind: "audio", mid: "0", bytesReceived: 7 },
];

describe("parseConnection", () => {
  it("reads the selected pair and encryption", () => {
    const c = parseConnection("publisher", reports());
    expect(c).toMatchObject({
      pc: "publisher",
      localType: "relay",
      remoteType: "host",
      protocol: "udp",
      relayed: true,
      relayProtocol: "tls",
      relayUrl: "turn:turn.example.com:443",
      remoteAddress: "203.0.113.5",
      remotePort: 50000,
      networkType: "wifi",
      dtlsState: "connected",
      dtlsCipher: "TLS_AES_128_GCM_SHA256",
      srtpCipher: "AEAD_AES_128_GCM",
    });
  });

  it("falls back to a nominated pair and returns nothing without one", () => {
    expect(parseConnection("subscriber", [])).toBeUndefined();
    const list = reports().filter((r) => r.type !== "transport");
    list[0] = { ...list[0], nominated: true, state: "succeeded" };
    expect(parseConnection("subscriber", list)?.remoteAddress).toBe(
      "203.0.113.5",
    );
  });

  it("gives equal keys for the same path only", () => {
    const a = parseConnection("publisher", reports(1))!;
    const b = parseConnection("publisher", reports(999))!;
    expect(connectionKey(a)).toBe(connectionKey(b));
    expect(connectionKey(a)).not.toBe(
      connectionKey({ ...a, remoteAddress: "198.51.100.1" }),
    );
  });
});

describe("parseBytes", () => {
  it("adds up simulcast layers and keeps directions apart", () => {
    const b = parseBytes("publisher", reports());
    expect(b.bytesSent).toBe(100);
    expect(b.tracks).toEqual([
      { direction: "out", kind: "video", id: "1", bytes: 30, packets: 0 },
      { direction: "in", kind: "audio", id: "0", bytes: 7, packets: 0 },
    ]);
  });

  it("changes the key only when counts change", () => {
    const a = parseBytes("publisher", reports(100));
    expect(bytesKey(a)).toBe(bytesKey(parseBytes("publisher", reports(100))));
    expect(bytesKey(a)).not.toBe(
      bytesKey(parseBytes("publisher", reports(101))),
    );
  });
});

describe("statsToRecords", () => {
  it("accepts a Map and ignores other values", () => {
    expect(
      statsToRecords(new Map([["a", { id: "a", type: "x" }]])),
    ).toHaveLength(1);
    expect(statsToRecords(undefined)).toEqual([]);
    expect(statsToRecords({})).toEqual([]);
  });
});

describe("describePayload", () => {
  it("gives size and preview", () => {
    expect(describePayload(new TextEncoder().encode("hi"))).toEqual({
      size: 2,
      preview: "hi",
      truncated: false,
    });
    expect(describePayload(undefined).size).toBe(0);
  });
});

describe("redaction of call entries", () => {
  const wrap = JSON.stringify({
    t: "wrap",
    v: 1,
    call: "c",
    from: "a",
    to: "b",
    epoch: 1,
    n: "nonce",
    iv: "SECRETIV",
    ct: "SECRETKEY",
  });
  const data = (preview: string, topic = "anytalk:e2ee"): TrafficEntry => ({
    kind: "call-data",
    id: 1,
    time: 0,
    direction: "out",
    topic,
    destination: ["b"],
    size: preview.length,
    preview,
    truncated: false,
  });

  it("hides wrapped keys in key exchange messages", () => {
    const e = redactEntry(data(wrap)) as { preview: string };
    expect(e.preview).not.toContain("SECRETKEY");
    expect(e.preview).not.toContain("SECRETIV");
    expect(e.preview).toContain(REDACTED);
    expect(e.preview).toContain('"to":"b"');
  });

  it("hides wrapped keys in cut off messages", () => {
    const cut = wrap.slice(0, wrap.length - 3);
    const e = redactEntry(data(cut)) as { preview: string };
    expect(e.preview).not.toContain("SECRETKEY");
  });

  it("leaves other topics and the hello's public keys alone", () => {
    const e = redactEntry(data('{"watching":["x"]}', "anytalk:watching")) as {
      preview: string;
    };
    expect(e.preview).toBe('{"watching":["x"]}');
    const hello = '{"v":1,"k":"PUB","s":"SIG","i":"PUBID"}';
    const attr = redactEntry({
      kind: "call-attribute",
      id: 2,
      time: 0,
      attributes: [{ key: "e2ee", value: hello }],
    } as TrafficEntry) as { attributes: { value: string }[] };
    expect(attr.attributes[0].value).toBe(hello);
  });

  it("hides attributes with secret names and url tokens", () => {
    const attr = redactEntry({
      kind: "call-attribute",
      id: 2,
      time: 0,
      attributes: [{ key: "token", value: "abc" }],
    } as TrafficEntry) as { attributes: { value: string }[] };
    expect(attr.attributes[0].value).toBe(REDACTED);
    const info = redactEntry({
      kind: "call-info",
      id: 3,
      time: 0,
      room: "r",
      url: "wss://sfu.example.com/rtc?access_token=SECRET",
      host: "sfu.example.com",
      e2ee: true,
    } as TrafficEntry) as { url: string };
    expect(info.url).not.toContain("SECRET");
  });
});

/** Any function, for listeners of the fake room. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...a: any[]) => any;

describe("monitorCall", () => {
  afterEach(() => vi.useRealTimers());

  /** A fake room with scriptable stats. */
  function fakeRoom(getStats: () => Promise<unknown>) {
    const publishData = vi.fn(async () => {});
    const setAttributes = vi.fn(async () => {});
    const listeners = new Map<string, AnyFn>();
    const room: CallRoomLike = {
      name: "room",
      localParticipant: { publishData, setAttributes },
      engine: { pcManager: { publisher: { _pc: {}, getStats } as never } },
      on: (e, l) => void listeners.set(e, l),
      off: (e) => void listeners.delete(e),
    };
    return { room, publishData, setAttributes, listeners };
  }

  it("records nothing while recording is off", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    const f = fakeRoom(async () => new Map());
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    const hooked = f.room.localParticipant.publishData!;
    await hooked(new Uint8Array(1), { topic: "t" });
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.publishData).toHaveBeenCalledOnce();
    expect(r.snapshot()).toHaveLength(0);
    stop();
  });

  it("records data, attributes, info and de-duplicated stats", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    let bytes = 100;
    const f = fakeRoom(
      async () => new Map(reports(bytes).map((x) => [x.id, x])),
    );
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    await f.room.localParticipant.publishData!(new Uint8Array([104]), {
      topic: "anytalk:watching",
      reliable: true,
      destinationIdentities: ["u1"],
    });
    await f.room.localParticipant.setAttributes!({ deafened: "true" });
    f.listeners.get("dataReceived")!(
      new Uint8Array([1, 2]),
      { identity: "u2" },
      undefined,
      "anytalk:e2ee",
    );
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000); // same counts: no new snapshot
    bytes = 200;
    await vi.advanceTimersByTimeAsync(5000);

    const kinds = r.snapshot().map((e) => e.kind);
    expect(kinds.filter((k) => k === "call-info")).toHaveLength(1);
    expect(kinds.filter((k) => k === "call-connection")).toHaveLength(1);
    expect(kinds.filter((k) => k === "call-bytes")).toHaveLength(2);
    const out = r.snapshot().find((e) => e.kind === "call-data");
    expect(out).toMatchObject({
      direction: "out",
      topic: "anytalk:watching",
      destination: ["u1"],
      reliable: true,
      size: 1,
    });
    expect(
      r
        .snapshot()
        .filter((e) => e.kind === "call-data" && e.direction === "in"),
    ).toHaveLength(1);
    expect(r.snapshot().find((e) => e.kind === "call-attribute")).toMatchObject(
      {
        attributes: [{ key: "deafened", value: "true" }],
      },
    );

    stop();
    // the original methods are back and nothing records after stopping
    expect(f.room.localParticipant.publishData).toBe(f.publishData);
    expect(f.listeners.size).toBe(0);
  });

  it("leaves the destination of received data messages out", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    const f = fakeRoom(async () => new Map());
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    f.listeners.get("dataReceived")!(
      new Uint8Array([1]),
      { identity: "u2" },
      undefined,
      "t",
    );
    const received = r.snapshot().find((e) => e.kind === "call-data");
    expect(received).toBeDefined();
    expect(received).not.toHaveProperty("destination");
    stop();
  });

  it("calls the only peer connection of single mode a connection", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    const f = fakeRoom(async () => new Map(reports(100).map((x) => [x.id, x])));
    // fakeRoom has only a publisher, as in single peer connection mode
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    await vi.advanceTimersByTimeAsync(5000);
    const pcs = r
      .snapshot()
      .filter((e) => e.kind === "call-connection" || e.kind === "call-bytes")
      .map((e) => (e as { pc: string }).pc);
    expect(pcs.length).toBeGreaterThan(0);
    expect(new Set(pcs)).toEqual(new Set(["connection"]));
    stop();
  });

  it("keeps publisher and subscriber when both exist", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    const getStats = async () => new Map(reports(100).map((x) => [x.id, x]));
    const f = fakeRoom(getStats);
    f.room.engine!.pcManager!.subscriber = { _pc: {}, getStats } as never;
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    await vi.advanceTimersByTimeAsync(5000);
    const pcs = r
      .snapshot()
      .filter((e) => e.kind === "call-connection")
      .map((e) => (e as { pc: string }).pc);
    expect(new Set(pcs)).toEqual(new Set(["publisher", "subscriber"]));
    stop();
  });

  it("survives missing or throwing stats", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    const f = fakeRoom(async () => {
      throw new Error("nope");
    });
    f.room.engine = undefined;
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => false });
    await vi.advanceTimersByTimeAsync(6000);
    expect(r.snapshot().map((e) => e.kind)).toEqual(["call-info"]);
    stop();
  });

  it("stops twice safely and records nothing from a tick in flight", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    let release: (v: unknown) => void = () => {};
    const f = fakeRoom(() => new Promise((resolve) => (release = resolve)));
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    await vi.advanceTimersByTimeAsync(5000); // info recorded, stats pending
    const before = r.snapshot().length;
    stop();
    stop();
    release(new Map(reports().map((x) => [x.id, x])));
    await vi.advanceTimersByTimeAsync(10000);
    expect(r.snapshot()).toHaveLength(before);
  });

  it("reads once when the room connects and ignores closed transports", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    const getStats = vi.fn(async () => new Map());
    const f = fakeRoom(getStats);
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    f.listeners.get("connected")!();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.snapshot().map((e) => e.kind)).toEqual(["call-info"]);
    expect(getStats).toHaveBeenCalledOnce();
    f.room.engine!.pcManager!.publisher = { _pc: null, getStats } as never;
    await vi.advanceTimersByTimeAsync(6000);
    expect(getStats).toHaveBeenCalledOnce();
    stop();
  });

  it("gives up on a stats read that never answers", async () => {
    vi.useFakeTimers();
    const r = new TrafficRecorder();
    r.enabled = true;
    const getStats = vi.fn(() => new Promise<unknown>(() => {}));
    const f = fakeRoom(getStats);
    const stop = monitorCall(f.room, r, { url: "wss://x", e2ee: () => true });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getStats.mock.calls.length).toBeGreaterThan(1);
    stop();
  });
});
