import { describe, expect, it } from "vitest";

import type { MessageEmbed } from "stoat.js";

import {
  isGif,
  isGifBox,
  isGifBoxUrl,
  isGifProviderHost,
  isGifProviderUrl,
} from "./gifs";

describe("isGifProviderUrl", () => {
  it("accepts real provider hosts and their CDN subdomains", () => {
    expect(isGifProviderUrl("https://tenor.com/view/x")).toBe(true);
    expect(isGifProviderUrl("https://media.tenor.com/a.mp4")).toBe(true);
    expect(isGifProviderUrl("https://media1.giphy.com/a.gif")).toBe(true);
    expect(isGifProviderUrl("https://gifbox.me/a")).toBe(true);
  });

  it("rejects spoofed hosts", () => {
    expect(isGifProviderUrl("https://tenor.com.evil.example/a.gif")).toBe(
      false,
    );
    expect(isGifProviderUrl("https://eviltenor.com/a.gif")).toBe(false);
    expect(isGifProviderUrl("https://evil.example/tenor.com/a.gif")).toBe(
      false,
    );
    expect(isGifProviderUrl("https://tenor.com@evil.example/a.gif")).toBe(
      false,
    );
  });

  it("rejects plain http, invalid and missing URLs", () => {
    expect(isGifProviderUrl("http://media.tenor.com/a.gif")).toBe(false);
    expect(isGifProviderUrl("not a url")).toBe(false);
    expect(isGifProviderUrl(undefined)).toBe(false);
  });
});

describe("isGifProviderHost", () => {
  it("matches whole labels only", () => {
    expect(isGifProviderHost("TENOR.com")).toBe(true);
    expect(isGifProviderHost("tenor.com.")).toBe(true);
    expect(isGifProviderHost("nottenor.com")).toBe(false);
  });
});

describe("isGifBoxUrl", () => {
  it("matches gifbox.me and subdomains only", () => {
    expect(isGifBoxUrl("https://gifbox.me/a")).toBe(true);
    expect(isGifBoxUrl("https://media.gifbox.me/a")).toBe(true);
    expect(isGifBoxUrl("https://gifbox.me.evil.example/a")).toBe(false);
    expect(isGifBoxUrl("nope")).toBe(false);
  });
});

describe("isGif / isGifBox", () => {
  /** Build a minimal embed for testing */
  const embed = (type: string, fields: object) =>
    ({ type, ...fields }) as unknown as MessageEmbed;

  it("does not throw on malformed URLs", () => {
    expect(isGif(embed("Image", { url: "::bad" }))).toBe(false);
    expect(isGif(embed("Website", { originalUrl: "::bad" }))).toBe(false);
    expect(isGifBox(embed("Video", { url: "::bad" }))).toBe(false);
  });

  it("treats provider CDN images and videos as GIFs", () => {
    expect(
      isGif(embed("Image", { url: "https://media.tenor.com/a.gif" })),
    ).toBe(true);
    expect(
      isGif(embed("Video", { url: "https://media1.giphy.com/a.mp4" })),
    ).toBe(true);
    expect(isGif(embed("Image", { url: "https://evil.example/a.gif" }))).toBe(
      false,
    );
  });

  it("ignores special GIF content on unrelated websites", () => {
    expect(
      isGif(
        embed("Website", {
          originalUrl: "https://evil.example/",
          specialContent: { type: "GIF" },
        }),
      ),
    ).toBe(false);
  });
});
