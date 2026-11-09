import { describe, expect, it } from "vitest";

import { buildHar, buildJson } from "./export";
import type { HttpEntry, ResourceEntry, WsEntry } from "./types";

const request: HttpEntry = {
  kind: "http",
  id: 1,
  source: "fetch",
  method: "POST",
  url: "https://api.example.com/x?a=1",
  host: "api.example.com",
  start: Date.UTC(2026, 9, 27, 12),
  end: Date.UTC(2026, 9, 27, 12) + 80,
  status: 201,
  requestHeaders: [["content-type", "application/json"]],
  responseHeaders: [["content-type", "application/json"]],
  requestBody: { kind: "text", size: 2, text: "{}", truncated: false },
  responsePreview: '{"ok":true}',
  protocol: "h2",
  durationMs: 70,
  encodedBodySize: 11,
  transferSize: 300,
};

const socket = (id: number, event: WsEntry["event"], extra = {}): WsEntry => ({
  kind: "ws",
  id,
  connectionId: 7,
  event,
  url: "wss://ws.example.com/",
  host: "ws.example.com",
  time: Date.UTC(2026, 9, 27, 12) + id,
  ...extra,
});

const image: ResourceEntry = {
  kind: "resource",
  id: 9,
  url: "https://cdn.example.com/a.png?v=2",
  host: "cdn.example.com",
  initiatorType: "img",
  start: Date.UTC(2026, 9, 27, 12) + 5,
  durationMs: 40,
  transferSize: 1300,
  encodedBodySize: 1000,
  decodedBodySize: 0,
  protocol: "h3",
  status: 200,
};

describe("buildHar", () => {
  it("writes http entries as HAR 1.2", () => {
    const har = buildHar([request]);
    expect(har.log.version).toBe("1.2");
    const entry = har.log.entries[0] as ReturnType<
      typeof buildHar
    >["log"]["entries"][number] & {
      request: {
        method: string;
        queryString: unknown;
        postData?: { text: string };
      };
      response: { status: number; httpVersion: string; bodySize: number };
    };
    expect(entry.startedDateTime).toBe("2026-10-27T12:00:00.000Z");
    expect(entry.time).toBe(70);
    expect(entry.request.method).toBe("POST");
    expect(entry.request.queryString).toEqual([{ name: "a", value: "1" }]);
    expect(entry.request.postData?.text).toBe("{}");
    expect(entry.response.status).toBe(201);
    expect(entry.response.httpVersion).toBe("HTTP/2.0");
    expect(entry.response.bodySize).toBe(11);
  });

  it("writes one entry per websocket with its frames", () => {
    const har = buildHar([
      socket(1, "open"),
      socket(2, "frame", { direction: "out", text: "hi" }),
      socket(3, "frame", { direction: "in", hex: "01 02" }),
      socket(4, "close", { code: 1000 }),
    ]);
    expect(har.log.entries).toHaveLength(1);
    const ws = har.log.entries[0] as unknown as {
      _webSocketMessages: { type: string; opcode: number; data: string }[];
    };
    expect(ws._webSocketMessages).toMatchObject([
      { type: "send", opcode: 1, data: "hi" },
      { type: "receive", opcode: 2, data: "01 02" },
    ]);
  });

  it("writes resources as entries with the data that exists", () => {
    const har = buildHar([image]);
    expect(har.log.entries).toHaveLength(1);
    const entry = har.log.entries[0] as unknown as {
      startedDateTime: string;
      time: number;
      request: { url: string; headers: unknown[]; queryString: unknown };
      response: {
        status: number;
        httpVersion: string;
        bodySize: number;
        content: { size: number };
        _transferSize: number;
      };
      _resourceType: string;
    };
    expect(entry.startedDateTime).toBe("2026-10-27T12:00:00.005Z");
    expect(entry.time).toBe(40);
    expect(entry.request.url).toBe(image.url);
    expect(entry.request.headers).toEqual([]);
    expect(entry.request.queryString).toEqual([{ name: "v", value: "2" }]);
    expect(entry.response.status).toBe(200);
    expect(entry.response.httpVersion).toBe("HTTP/3.0");
    expect(entry.response.bodySize).toBe(1000);
    // an unknown decoded size is written as -1, not 0
    expect(entry.response.content.size).toBe(-1);
    expect(entry.response._transferSize).toBe(1300);
    expect(entry._resourceType).toBe("img");
  });

  it("leaves call entries out and sorts by start time", () => {
    const har = buildHar([
      image,
      request,
      {
        kind: "call-info",
        id: 10,
        time: 0,
        room: "r",
        url: "wss://lk.test",
        host: "lk.test",
        e2ee: true,
      },
    ]);
    expect(har.log.entries).toHaveLength(2);
    expect(har.log.entries[0].startedDateTime).toBe("2026-10-27T12:00:00.000Z");
  });

  it("gives websocket frames an absolute time too", () => {
    const har = buildHar([
      socket(1, "open"),
      socket(2, "frame", { direction: "out", text: "hi" }),
    ]);
    const ws = har.log.entries[0] as unknown as {
      _webSocketMessages: { _timestamp: string }[];
    };
    expect(ws._webSocketMessages[0]._timestamp).toBe(
      "2026-10-27T12:00:00.002Z",
    );
  });

  it("is a valid empty document without entries", () => {
    expect(buildHar([]).log.entries).toEqual([]);
  });
});

describe("buildJson", () => {
  it("keeps every entry and adds an absolute timestamp", () => {
    const json = buildJson([request, socket(3, "open"), image]);
    expect(json.entries[0]).toMatchObject({
      ...request,
      timestamp: "2026-10-27T12:00:00.000Z",
      service: "other",
    });
    expect(json.entries[1].timestamp).toBe("2026-10-27T12:00:00.003Z");
    expect(json.entries[2].timestamp).toBe("2026-10-27T12:00:00.005Z");
    expect(typeof json.exportedAt).toBe("string");
  });
});
