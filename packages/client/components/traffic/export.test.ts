import { describe, expect, it } from "vitest";

import { buildHar, buildJson } from "./export";
import type { HttpEntry, WsEntry } from "./types";

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

  it("is a valid empty document without entries", () => {
    expect(buildHar([]).log.entries).toEqual([]);
  });
});

describe("buildJson", () => {
  it("keeps every entry as given", () => {
    const json = buildJson([request]);
    expect(json.entries).toEqual([request]);
    expect(typeof json.exportedAt).toBe("string");
  });
});
