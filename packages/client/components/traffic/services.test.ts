import { describe, expect, it } from "vitest";

import type { ServiceUrls } from "./services";
import { classifyService } from "./services";
import type { TrafficEntry } from "./types";

const urls: ServiceUrls = {
  api: "https://chat.test/api",
  events: "wss://chat.test/events",
  uploads: "https://files.test",
  embeds: "https://proxy.test/",
  gif: ["https://gifs.test"],
};

const http = (url: string): TrafficEntry => ({
  kind: "http",
  id: 1,
  source: "fetch",
  method: "GET",
  url,
  host: new URL(url).host,
  start: 0,
  end: 1,
  requestHeaders: [],
  responseHeaders: [],
  requestBody: { kind: "none" },
});

const socket = (url: string): TrafficEntry => ({
  kind: "ws",
  id: 2,
  connectionId: 1,
  event: "open",
  url,
  host: "",
  time: 0,
});

describe("classifyService", () => {
  it("tells services on one host apart by path", () => {
    expect(classifyService(http("https://chat.test/api/users/@me"), urls)).toBe(
      "api",
    );
    expect(classifyService(socket("wss://chat.test/events?v=1"), urls)).toBe(
      "events",
    );
    expect(classifyService(http("https://chat.test/other"), urls)).toBe(
      "other",
    );
    expect(classifyService(http("https://chat.test/apix"), urls)).toBe("other");
  });

  it("matches uploads, embeds proxy and gif provider by host", () => {
    expect(
      classifyService(http("https://files.test/attachments/x"), urls),
    ).toBe("uploads");
    expect(classifyService(http("https://proxy.test/proxy?url=a"), urls)).toBe(
      "embeds",
    );
    expect(classifyService(http("https://gifs.test/categories"), urls)).toBe(
      "gif",
    );
  });

  it("treats Tenor, Giphy and their CDN subdomains as GIF providers", () => {
    for (const url of [
      "https://tenor.com/view/x",
      "https://media.tenor.com/a.mp4",
      "https://media1.giphy.com/media/a/giphy.mp4",
      "https://i.giphy.com/a.gif",
    ]) {
      expect(classifyService(http(url), {})).toBe("gif");
    }
    expect(classifyService(http("https://nottenor.com/"), {})).toBe("other");
    expect(classifyService(http("https://tenor.com.evil.test/"), {})).toBe(
      "other",
    );
  });

  it("keeps api and events apart when they share host and path", () => {
    const same: ServiceUrls = { api: "http://h:1", events: "ws://h:1" };
    expect(classifyService(http("http://h:1/"), same)).toBe("api");
    expect(classifyService(socket("ws://h:1/"), same)).toBe("events");
  });

  it("compares ports", () => {
    expect(classifyService(http("https://files.test:8443/x"), urls)).toBe(
      "other",
    );
  });

  it("recognises LiveKit's signalling socket by path", () => {
    expect(classifyService(socket("wss://lk.test/rtc/v1?x=1"), urls)).toBe(
      "call-signalling",
    );
    expect(classifyService(http("https://lk.test/rtc/validate"), urls)).toBe(
      "call-signalling",
    );
  });

  it("finds the signalling path behind a prefix", () => {
    for (const url of [
      "wss://host/livekit/rtc",
      "wss://host/livekit/rtc/v1?x=1",
      "https://host/livekit/rtc/validate",
    ]) {
      expect(classifyService(socket(url), { api: "https://host" })).toBe(
        "call-signalling",
      );
    }
    expect(classifyService(http("https://host/rtcx"), {})).toBe("other");
  });

  it("lets the joined LiveKit server claim its host over the api", () => {
    const shared: ServiceUrls = {
      api: "https://host",
      signalling: "wss://host/lk",
    };
    expect(classifyService(socket("wss://host/lk/anything"), shared)).toBe(
      "call-signalling",
    );
    expect(classifyService(http("https://host/users"), shared)).toBe("api");
    const sameRoot: ServiceUrls = {
      api: "https://host",
      signalling: "wss://host",
    };
    expect(classifyService(socket("wss://host/connect"), sameRoot)).toBe(
      "call-signalling",
    );
  });

  it("classifies call entries by kind", () => {
    const base = { id: 3, time: 0 };
    expect(
      classifyService(
        {
          ...base,
          kind: "call-info",
          room: "r",
          url: "",
          host: "",
          e2ee: true,
        },
        urls,
      ),
    ).toBe("call-signalling");
    expect(
      classifyService(
        { ...base, kind: "call-connection", pc: "publisher", relayed: false },
        urls,
      ),
    ).toBe("call-media");
    expect(
      classifyService(
        { ...base, kind: "call-bytes", pc: "publisher", tracks: [] },
        urls,
      ),
    ).toBe("call-media");
  });

  it("falls back to other without configuration or on bad urls", () => {
    expect(classifyService(http("https://x.test/"), {})).toBe("other");
    expect(classifyService(socket("not a url"), urls)).toBe("other");
  });
});
