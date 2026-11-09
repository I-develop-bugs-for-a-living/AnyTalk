import { describe, expect, it } from "vitest";

import {
  PREVIEW_LIMIT,
  findHeader,
  hexPreview,
  hostOf,
  isTextContentType,
  parseRawHeaders,
  summarizeBody,
} from "./summarize";

describe("summarizeBody", () => {
  it("handles empty bodies", () => {
    expect(summarizeBody(undefined)).toEqual({ kind: "none" });
    expect(summarizeBody(null)).toEqual({ kind: "none" });
  });

  it("keeps strings as text and truncates long ones", () => {
    expect(summarizeBody("héllo")).toEqual({
      kind: "text",
      size: 6,
      text: "héllo",
      truncated: false,
    });
    const long = summarizeBody("a".repeat(PREVIEW_LIMIT + 5));
    expect(long).toMatchObject({ kind: "text", truncated: true });
    expect((long as { text: string }).text).toHaveLength(PREVIEW_LIMIT);
  });

  it("summarizes FormData without values", () => {
    const form = new FormData();
    form.append("name", "secret value");
    form.append("file", new Blob(["abc"], { type: "image/png" }), "a.png");
    expect(summarizeBody(form)).toEqual({
      kind: "form",
      fields: [
        { name: "name" },
        { name: "file", file: { name: "a.png", size: 3, type: "image/png" } },
      ],
    });
  });

  it("summarizes binary data and streams", () => {
    expect(summarizeBody(new Blob(["abcd"], { type: "text/x" }))).toEqual({
      kind: "binary",
      size: 4,
      type: "text/x",
    });
    expect(summarizeBody(new ArrayBuffer(8))).toEqual({
      kind: "binary",
      size: 8,
    });
    expect(summarizeBody(new ReadableStream())).toEqual({ kind: "stream" });
  });
});

describe("hexPreview", () => {
  it("shows the first bytes", () => {
    const data = new Uint8Array([1, 2, 255, 16]);
    expect(hexPreview(data, 3)).toEqual({
      hex: "01 02 ff",
      truncated: true,
      size: 4,
    });
  });

  it("respects view offsets", () => {
    const buf = new Uint8Array([9, 8, 7, 6]).buffer;
    expect(hexPreview(new Uint8Array(buf, 2, 2)).hex).toBe("07 06");
  });
});

describe("helpers", () => {
  it("finds hosts", () => {
    expect(hostOf("https://a.example:8080/x")).toBe("a.example:8080");
    expect(hostOf("/x", "https://b.example")).toBe("b.example");
    expect(hostOf("not a url")).toBe("");
  });

  it("parses raw headers", () => {
    expect(parseRawHeaders("A: 1\r\nContent-Type: text/plain\r\n")).toEqual([
      ["A", "1"],
      ["Content-Type", "text/plain"],
    ]);
  });

  it("detects text content types and headers", () => {
    expect(isTextContentType("application/json; charset=utf-8")).toBe(true);
    expect(isTextContentType("image/png")).toBe(false);
    expect(findHeader([["Content-Length", "5"]], "content-length")).toBe("5");
  });
});
