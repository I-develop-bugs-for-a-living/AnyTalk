import { describe, expect, it } from "vitest";

import { deriveGifboxUrl, resolveGifboxUrl } from "./gifboxUrl";

describe("deriveGifboxUrl", () => {
  it("uses a same-origin january or autumn path", () => {
    expect(
      deriveGifboxUrl(["https://chat.example/january"], "https://chat.example"),
    ).toBe("https://chat.example/gifbox");
    expect(
      deriveGifboxUrl(
        [undefined, "https://example.com/stoat/autumn/"],
        "https://example.com/stoat/api",
      ),
    ).toBe("https://example.com/stoat/gifbox");
  });

  it("ignores candidates on another origin", () => {
    expect(
      deriveGifboxUrl(
        ["https://cdn.other.example/autumn"],
        "https://chat.example/api",
      ),
    ).toBe("https://chat.example/gifbox");
  });

  it("derives from the API URL keeping its base path", () => {
    expect(deriveGifboxUrl([], "https://host/api")).toBe("https://host/gifbox");
    expect(deriveGifboxUrl([], "https://host/stoat/api")).toBe(
      "https://host/stoat/gifbox",
    );
    expect(deriveGifboxUrl([], "https://api.example")).toBe(
      "https://api.example/gifbox",
    );
  });

  it("returns undefined without a usable API URL", () => {
    expect(deriveGifboxUrl([], "nope")).toBeUndefined();
    expect(deriveGifboxUrl([])).toBeUndefined();
  });
});

describe("resolveGifboxUrl", () => {
  const api = "https://api.example.com";

  it("prefers advertised, then override, then derived", () => {
    expect(
      resolveGifboxUrl(
        "https://gifbox.example.com/",
        "https://b.test",
        "https://c.test",
        api,
      ),
    ).toBe("https://gifbox.example.com");
    expect(
      resolveGifboxUrl(undefined, "https://b.test", "https://c.test", api),
    ).toBe("https://b.test");
    expect(resolveGifboxUrl(undefined, undefined, "https://c.test", api)).toBe(
      "https://c.test",
    );
  });

  it("rejects an advertised URL on an unrelated host", () => {
    expect(
      resolveGifboxUrl(
        "https://evil.example/gifbox",
        undefined,
        "https://c.test",
        api,
      ),
    ).toBe("https://c.test");
    expect(
      resolveGifboxUrl(
        "https://example.com.evil.test",
        undefined,
        undefined,
        api,
      ),
    ).toBeUndefined();
  });

  it("rejects gifbox.me everywhere and falls through", () => {
    expect(
      resolveGifboxUrl(
        "https://gifbox.me",
        "https://api.gifbox.me",
        "https://c.test",
        "https://gifbox.me",
      ),
    ).toBe("https://c.test");
  });

  it("allows http only for local and private hosts", () => {
    expect(
      resolveGifboxUrl(undefined, "http://localhost:14706", undefined, api),
    ).toBe("http://localhost:14706");
    expect(
      resolveGifboxUrl(undefined, "http://192.168.1.5:1", undefined, api),
    ).toBe("http://192.168.1.5:1");
    expect(resolveGifboxUrl(undefined, "http://[::1]:1", undefined, api)).toBe(
      "http://[::1]:1",
    );
    expect(
      resolveGifboxUrl(undefined, "http://evil.test", undefined, api),
    ).toBeUndefined();
    expect(
      resolveGifboxUrl(undefined, "http://172.32.0.1", undefined, api),
    ).toBeUndefined();
  });

  it("skips invalid values", () => {
    expect(resolveGifboxUrl("javascript:x", "bad", "https://c.test", api)).toBe(
      "https://c.test",
    );
    expect(resolveGifboxUrl()).toBeUndefined();
  });
});
