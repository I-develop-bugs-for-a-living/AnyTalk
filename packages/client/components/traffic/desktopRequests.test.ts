import { describe, expect, it } from "vitest";

import {
  type DesktopRequestEvent,
  desktopRequestToEntry,
  isDesktopFile,
} from "./desktopRequests";
import { redactEntry } from "./redact";
import type { HttpEntry } from "./types";

/** An event with defaults. */
function event(extra: Partial<DesktopRequestEvent> = {}): DesktopRequestEvent {
  return {
    id: 1,
    method: "GET",
    url: "https://cdn.example.com/a.png?token=abc",
    resourceType: "image",
    start: 1000,
    end: 1040,
    background: false,
    requestHeaders: [["Cookie", "s=1"]],
    status: 200,
    statusLine: "HTTP/1.1 200 OK",
    responseHeaders: [["Content-Length", "512"]],
    fromCache: false,
    ...extra,
  };
}

describe("desktopRequestToEntry", () => {
  it("maps an event to an http entry from the desktop app", () => {
    expect(desktopRequestToEntry(event())).toMatchObject({
      kind: "http",
      source: "desktop",
      host: "cdn.example.com",
      status: 200,
      statusText: "OK",
      responseSize: 512,
      resourceType: "image",
      requestBody: { kind: "none" },
    });
  });

  it("keeps errors and ignores a bad content length", () => {
    const entry = desktopRequestToEntry(
      event({
        status: undefined,
        statusLine: undefined,
        error: "net::ERR_FAILED",
        responseHeaders: [["content-length", "x"]],
      }),
    );
    expect(entry).toMatchObject({ error: "net::ERR_FAILED" });
    expect((entry as HttpEntry).responseSize).toBeUndefined();
  });

  it("goes through the same redaction as page entries", () => {
    const entry = desktopRequestToEntry(
      event({
        responseHeaders: [["Set-Cookie", "sid=1"]],
        requestHeaders: [["Authorization", "Bearer x"]],
      }),
    );
    const redacted = redactEntry({ ...entry, id: 1 } as HttpEntry);
    expect(redacted.url).toBe("https://cdn.example.com/a.png?token=[redacted]");
    expect(redacted.requestHeaders).toEqual([["Authorization", "[redacted]"]]);
    expect(redacted.responseHeaders).toEqual([["Set-Cookie", "[redacted]"]]);
  });
});

describe("isDesktopFile", () => {
  it("tells files from requests", () => {
    const make = (resourceType: string) =>
      ({
        ...desktopRequestToEntry(event({ resourceType })),
        id: 1,
      }) as HttpEntry;
    expect(isDesktopFile(make("image"))).toBe(true);
    expect(isDesktopFile(make("font"))).toBe(true);
    expect(isDesktopFile(make("xhr"))).toBe(false);
    expect(isDesktopFile(make("mainFrame"))).toBe(false);
  });
});
