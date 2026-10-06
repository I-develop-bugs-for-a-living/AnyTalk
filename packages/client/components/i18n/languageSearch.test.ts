import { describe, expect, test } from "vitest";

import {
  displayNameCacheSize,
  languageMatchesQuery,
  normaliseSearch,
} from "./languageSearch";

describe("normaliseSearch", () => {
  test("ignores case and accents", () => {
    expect(normaliseSearch("  Français ")).toBe("francais");
  });
});

describe("languageMatchesQuery", () => {
  test("empty query matches everything", () => {
    expect(languageMatchesQuery("", "de", "Deutsch", "en")).toBe(true);
    expect(languageMatchesQuery("  ", "de", "Deutsch", "en")).toBe(true);
  });

  test("matches native name, code and English name", () => {
    expect(languageMatchesQuery("deutsch", "de", "Deutsch", "en")).toBe(true);
    expect(languageMatchesQuery("DE", "de", "Deutsch", "en")).toBe(true);
    expect(languageMatchesQuery("german", "de", "Deutsch", "en")).toBe(true);
  });

  test("matches the name in the UI language", () => {
    expect(languageMatchesQuery("allemand", "de", "Deutsch", "fr")).toBe(true);
  });

  test("ignores accents", () => {
    expect(languageMatchesQuery("francais", "fr", "Français", "en")).toBe(true);
  });

  test("does not match unrelated languages", () => {
    expect(languageMatchesQuery("german", "fr", "Français", "en")).toBe(false);
  });

  test("handles codes Intl does not know", () => {
    expect(languageMatchesQuery("toki", "tokipona", "toki pona", "en")).toBe(
      true,
    );
    expect(languageMatchesQuery("zzz", "tokipona", "toki pona", "en")).toBe(
      false,
    );
  });
});

describe("display name cache", () => {
  test("repeated searches reuse cached lookups", () => {
    languageMatchesQuery("a", "pt", "Português", "en");
    const size = displayNameCacheSize();
    languageMatchesQuery("b", "pt", "Português", "en");
    expect(displayNameCacheSize()).toBe(size);
  });
});
