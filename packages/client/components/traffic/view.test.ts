import { describe, expect, it } from "vitest";

import type {
  CallBytesEntry,
  CallConnectionEntry,
  HttpEntry,
  ResourceEntry,
  TrafficEntry,
  WsEntry,
} from "./types";
import {
  filterEntries,
  hideCallNoise,
  mergeResources,
  pauseCutoff,
  summarizeDestinations,
  upToId,
} from "./view";

const BASE = "https://app.example.com/";

/** An http entry with defaults. */
function http(id: number, url: string, start: number, extra = {}): HttpEntry {
  return {
    kind: "http",
    id,
    source: "fetch",
    method: "GET",
    url,
    host: new URL(url, BASE).host,
    start,
    end: start + 50,
    status: 200,
    requestHeaders: [],
    responseHeaders: [],
    requestBody: { kind: "none" },
    ...extra,
  };
}

/** A resource entry with defaults. */
function resource(
  id: number,
  url: string,
  start: number,
  initiatorType = "fetch",
): ResourceEntry {
  return {
    kind: "resource",
    id,
    url,
    host: new URL(url).host,
    initiatorType,
    start,
    durationMs: 42,
    transferSize: 1234,
    encodedBodySize: 1000,
    decodedBodySize: 3000,
    protocol: "h2",
  };
}

/** A websocket frame entry. */
function frame(id: number, url: string, size = 10): WsEntry {
  return {
    kind: "ws",
    id,
    connectionId: 1,
    event: "frame",
    url,
    host: new URL(url).host,
    time: id,
    direction: "in",
    size,
  };
}

describe("mergeResources", () => {
  it("folds a fetch resource into its http entry", () => {
    const merged = mergeResources(
      [
        http(1, "/api/users", 1000),
        resource(2, "https://app.example.com/api/users", 1030),
      ],
      BASE,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kind: "http",
      protocol: "h2",
      transferSize: 1234,
      encodedBodySize: 1000,
      decodedBodySize: 3000,
      durationMs: 42,
    });
  });

  it("keeps other resource types and far-apart starts", () => {
    const entries: TrafficEntry[] = [
      http(1, "/a.png", 1000),
      resource(2, "https://app.example.com/a.png", 1010, "img"),
      http(3, "/b", 1000),
      resource(4, "https://app.example.com/b", 2000),
    ];
    expect(mergeResources(entries, BASE)).toHaveLength(4);
  });

  it("matches each http entry once, nearest first", () => {
    const merged = mergeResources(
      [
        http(1, "/x", 1000),
        http(2, "/x", 1060),
        resource(3, "https://app.example.com/x", 1055),
        resource(4, "https://app.example.com/x", 1005),
      ],
      BASE,
    );
    expect(merged.map((e) => e.kind)).toEqual(["http", "http"]);
    expect(merged.every((e) => (e as HttpEntry).durationMs === 42)).toBe(true);
  });

  it("drops a second resource when its http entry is taken", () => {
    const merged = mergeResources(
      [
        http(1, "/x", 1000),
        resource(2, "https://app.example.com/x", 1000),
        resource(3, "https://app.example.com/x", 1010),
      ],
      BASE,
    );
    expect(merged.map((e) => e.kind)).toEqual(["http", "resource"]);
  });

  it("does not change its input", () => {
    const entries = [
      http(1, "/x", 1000),
      resource(2, "https://app.example.com/x", 1000),
    ];
    mergeResources(entries, BASE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).not.toHaveProperty("protocol");
  });
});

describe("hideCallNoise", () => {
  const bytes = (id: number, ids: string[]): CallBytesEntry => ({
    kind: "call-bytes",
    id,
    time: id,
    pc: "publisher",
    tracks: ids.map((t) => ({
      direction: "out",
      kind: "audio",
      id: t,
      bytes: id,
      packets: 1,
    })),
  });

  it("drops signalling frames but keeps the socket events and other sockets", () => {
    const open: WsEntry = {
      ...frame(1, "wss://sfu.example.com/rtc/v1?x=1"),
      event: "open",
    };
    const out = hideCallNoise([
      open,
      frame(2, "wss://sfu.example.com/rtc/v1?x=1"),
      frame(3, "wss://sfu.example.com/rtc"),
      frame(4, "wss://api.example.com/ws"),
    ]);
    expect(out.map((e) => e.id)).toEqual([1, 4]);
  });

  it("keeps a byte snapshot only when the streams changed", () => {
    const out = hideCallNoise([
      bytes(1, ["a"]),
      bytes(2, ["a"]),
      bytes(3, ["a", "b"]),
      bytes(4, ["a", "b"]),
    ]);
    expect(out.map((e) => e.id)).toEqual([1, 3]);
  });
});

describe("filterEntries", () => {
  const entries: TrafficEntry[] = [
    http(1, "https://api.example.com/users", 1),
    frame(2, "wss://ws.example.com/socket"),
    resource(3, "https://cdn.example.com/a.png", 3, "img"),
  ];

  it("filters by group and text", () => {
    expect(filterEntries(entries, { group: "ws" }).map((e) => e.id)).toEqual([
      2,
    ]);
    expect(filterEntries(entries, { text: "CDN" }).map((e) => e.id)).toEqual([
      3,
    ]);
    expect(
      filterEntries(entries, { group: "http", text: "socket" }),
    ).toHaveLength(0);
  });

  it("matches the topic of data messages", () => {
    const data: TrafficEntry = {
      kind: "call-data",
      id: 9,
      time: 9,
      direction: "in",
      topic: "anytalk:watching",
      size: 1,
      preview: "",
      truncated: false,
    };
    expect(filterEntries([data], { text: "watching" })).toHaveLength(1);
  });
});

describe("summarizeDestinations", () => {
  it("groups by host and type with counts and bytes", () => {
    const connection: CallConnectionEntry = {
      kind: "call-connection",
      id: 10,
      time: 10,
      pc: "connection",
      relayed: false,
      remoteAddress: "203.0.113.5",
      remotePort: 7882,
    };
    const calls: CallBytesEntry = {
      kind: "call-bytes",
      id: 11,
      time: 11,
      pc: "connection",
      bytesSent: 100,
      bytesReceived: 50,
      tracks: [],
    };
    const rows = summarizeDestinations([
      http(1, "https://api.example.com/a", 1, { responseSize: 100 }),
      http(2, "https://api.example.com/b", 2, { responseSize: 50 }),
      frame(3, "wss://api.example.com/ws", 20),
      resource(4, "https://cdn.example.com/a.png", 4, "img"),
      connection,
      calls,
    ]);
    expect(rows.find((r) => r.type === "https")).toEqual({
      host: "api.example.com",
      type: "https",
      count: 2,
      bytes: 150,
    });
    expect(rows.find((r) => r.type === "wss")).toMatchObject({
      count: 1,
      bytes: 20,
    });
    expect(rows.find((r) => r.type === "files")).toMatchObject({
      host: "cdn.example.com",
      bytes: 1234,
    });
    expect(rows.find((r) => r.type === "call")).toEqual({
      host: "203.0.113.5:7882",
      type: "call",
      count: 1,
      bytes: 150,
    });
  });

  it("is empty without entries", () => {
    expect(summarizeDestinations([])).toEqual([]);
  });
});

describe("pause cutoff", () => {
  const list: TrafficEntry[] = [
    http(1, "/a", 1),
    http(2, "/b", 2),
    http(3, "/c", 3),
  ];

  it("keeps only entries up to the cutoff", () => {
    const cutoff = pauseCutoff(list);
    expect(cutoff).toBe(3);
    const later = [...list, http(4, "/d", 4)];
    expect(upToId(later, cutoff).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("handles an empty list and no cutoff", () => {
    expect(pauseCutoff([])).toBe(0);
    expect(upToId([], 0)).toEqual([]);
    expect(upToId(list, undefined)).toBe(list);
  });
});
