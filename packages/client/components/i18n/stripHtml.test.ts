// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import { stripHtml } from "./stripHtml";

describe("stripHtml", () => {
  test("keeps plain text", () => {
    expect(stripHtml("Something broke")).toBe("Something broke");
  });

  test("decodes entities", () => {
    expect(stripHtml("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });

  test("strips tags, head and contentinfo", () => {
    expect(
      stripHtml(
        "<html><head><title>T</title></head><body><h1>502</h1><p>Bad</p><footer role=contentinfo>nginx</footer></body></html>",
      ),
    ).toBe("502Bad");
  });

  test("keeps text of body scripts", () => {
    expect(stripHtml("hi<script>var a = 1;</script>")).toBe("hivar a = 1;");
  });

  test("reads noscript content as markup", () => {
    expect(stripHtml("<noscript><p>x</p></noscript>")).toBe("x");
  });

  test("excludes template content", () => {
    expect(stripHtml("a<template><b>hidden</b></template>c")).toBe("ac");
  });

  test("returns an empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });

  // jsdom fires no event handlers from innerHTML (no resource loading), so
  // a payload check can't tell the old and new code apart. Instead assert
  // that the live document is never used to parse the input.
  test("never parses input with innerHTML on a live element", () => {
    const setter = vi.fn();
    const original = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "innerHTML",
    )!;
    Object.defineProperty(Element.prototype, "innerHTML", {
      configurable: true,
      get: original.get,
      set: setter,
    });
    const create = vi.spyOn(document, "createElement");
    try {
      expect(stripHtml('<img src=x onerror="window.__pwned=1">hi')).toBe("hi");
      expect(setter).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      Object.defineProperty(Element.prototype, "innerHTML", original);
    }
  });
});
