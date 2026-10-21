import { describe, expect, it } from "vitest";

import { Languages, intlLocale } from "./Languages";

describe("intlLocale", () => {
  it("maps the joke languages to en", () => {
    for (const key of ["leet", "enchantment", "bottom", "piglatin"]) {
      expect(intlLocale(key)).toBe("en");
    }
  });

  it("returns a locale Intl accepts for every language", () => {
    for (const key of Object.keys(Languages)) {
      expect(() => new Intl.PluralRules([intlLocale(key)])).not.toThrow();
    }
  });

  it("works with DateTimeFormat and DurationFormat for every language", () => {
    const Duration = (
      Intl as unknown as { DurationFormat?: new (l: string[]) => unknown }
    ).DurationFormat;
    for (const key of Object.keys(Languages)) {
      expect(() => new Intl.DateTimeFormat([intlLocale(key)])).not.toThrow();
      if (Duration) expect(() => new Duration([intlLocale(key)])).not.toThrow();
    }
  });
});
