import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  flattenResponseHeaders,
  shouldReport,
  toDesktopRequest,
} from "./requestWatchLogic.ts";

const base = { id: 1, method: "GET", timestamp: 2000 };

describe("shouldReport", () => {
  it("skips what the page recorder logs", () => {
    assert.equal(
      shouldReport(
        { url: "https://a.test/api", resourceType: "xhr", webContentsId: 3 },
        3,
      ),
      false,
    );
    assert.equal(
      shouldReport(
        { url: "wss://a.test/ws", resourceType: "webSocket", webContentsId: 3 },
        3,
      ),
      false,
    );
  });

  it("reports resource loads of the page", () => {
    for (const resourceType of ["image", "media", "script", "font"]) {
      assert.equal(
        shouldReport(
          { url: "https://a.test/x", resourceType, webContentsId: 3 },
          3,
        ),
        true,
      );
    }
  });

  it("skips pageless fetch to the app's own server (service worker)", () => {
    assert.equal(
      shouldReport(
        { url: "https://a.test/api", resourceType: "xhr" },
        3,
        "https://a.test",
      ),
      false,
    );
    assert.equal(
      shouldReport(
        { url: "https://other.test/api", resourceType: "xhr" },
        3,
        "https://a.test",
      ),
      true,
    );
  });

  it("reports fetch from other contexts", () => {
    assert.equal(
      shouldReport({ url: "https://a.test/", resourceType: "xhr" }, 3),
      true,
    );
    assert.equal(
      shouldReport(
        { url: "https://a.test/", resourceType: "xhr", webContentsId: 9 },
        3,
      ),
      true,
    );
  });

  it("ignores other schemes", () => {
    assert.equal(
      shouldReport({ url: "file:///a.html", resourceType: "mainFrame" }, 3),
      false,
    );
    assert.equal(
      shouldReport({ url: "devtools://x", resourceType: "script" }, 3),
      false,
    );
  });
});

describe("flattenResponseHeaders", () => {
  it("gives one entry per value", () => {
    assert.deepEqual(
      flattenResponseHeaders({ "Set-Cookie": ["a=1", "b=2"], Type: ["x"] }),
      [
        ["Set-Cookie", "a=1"],
        ["Set-Cookie", "b=2"],
        ["Type", "x"],
      ],
    );
    assert.deepEqual(flattenResponseHeaders(undefined), []);
  });
});

describe("toDesktopRequest", () => {
  it("joins what was seen when sending with the result", () => {
    const out = toDesktopRequest(
      {
        ...base,
        url: "https://a.test/i.png",
        resourceType: "image",
        webContentsId: 3,
        statusCode: 200,
        statusLine: "HTTP/1.1 200 OK",
        responseHeaders: { "Content-Type": ["image/png"] },
        ip: "1.2.3.4",
      },
      { start: 1900, requestHeaders: [["Cookie", "s=1"]] },
    );
    assert.equal(out.start, 1900);
    assert.equal(out.end, 2000);
    assert.equal(out.background, false);
    assert.equal(out.status, 200);
    assert.deepEqual(out.requestHeaders, [["Cookie", "s=1"]]);
    assert.deepEqual(out.responseHeaders, [["Content-Type", "image/png"]]);
    assert.equal(out.fromCache, false);
  });

  it("handles cached and failed requests without a pending entry", () => {
    const cached = toDesktopRequest(
      {
        ...base,
        url: "https://a.test/",
        resourceType: "script",
        fromCache: true,
      },
      undefined,
    );
    assert.equal(cached.start, 2000);
    assert.equal(cached.background, true);
    assert.equal(cached.fromCache, true);
    assert.deepEqual(cached.requestHeaders, []);
    const failed = toDesktopRequest(
      {
        ...base,
        url: "https://a.test/",
        resourceType: "image",
        error: "net::ERR_FAILED",
      },
      undefined,
    );
    assert.equal(failed.error, "net::ERR_FAILED");
    assert.equal(failed.status, undefined);
  });
});
