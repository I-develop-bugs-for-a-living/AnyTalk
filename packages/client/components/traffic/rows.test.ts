import { describe, expect, it } from "vitest";

import { describeRow } from "./rows";
import type { TrafficEntry } from "./types";

describe("describeRow", () => {
  it("shows method, status and path of a request", () => {
    expect(
      describeRow({
        kind: "http",
        id: 1,
        source: "fetch",
        method: "GET",
        url: "https://api.example.com/users?a=1",
        host: "api.example.com",
        start: 0,
        end: 1,
        status: 200,
        requestHeaders: [],
        responseHeaders: [],
        requestBody: { kind: "none" },
      }),
    ).toMatchObject({
      badge: "HTTP",
      method: "GET",
      status: "200",
      summary: "/users?a=1",
      host: "api.example.com",
    });
  });

  it("shows a failed request as ERR", () => {
    const row = describeRow({
      kind: "http",
      id: 1,
      source: "xhr",
      method: "POST",
      url: "https://x.example.com/",
      host: "x.example.com",
      start: 0,
      end: 1,
      error: "network",
      requestHeaders: [],
      responseHeaders: [],
      requestBody: { kind: "none" },
    });
    expect(row.status).toBe("ERR");
  });

  it("shows the direction and topic of a data message", () => {
    const entry: TrafficEntry = {
      kind: "call-data",
      id: 2,
      time: 0,
      direction: "in",
      topic: "anytalk:watching",
      size: 3,
      preview: "x",
      truncated: false,
    };
    expect(describeRow(entry)).toMatchObject({
      badge: "CALL",
      dir: "in",
      summary: "anytalk:watching",
    });
  });

  it("shows a text frame as a flat, short preview", () => {
    const row = describeRow({
      kind: "ws",
      id: 3,
      connectionId: 1,
      event: "frame",
      url: "wss://x.example.com/ws",
      host: "x.example.com",
      time: 0,
      direction: "out",
      text: "a\n  b",
    });
    expect(row).toMatchObject({ badge: "WS", dir: "out", summary: "a b" });
  });
});
