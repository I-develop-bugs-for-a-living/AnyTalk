import { describe, expect, test } from "vitest";

import {
  encodeBottom,
  encodeEnchantment,
  encodeForLocale,
  encodeLeet,
  encodePigLatin,
} from "./po-encode-lib";

describe("encoders", () => {
  test("leet", () => {
    expect(encodeLeet("Accept friend request")).toBe("4CC3P7 F213ND 23QU357");
    expect(encodeLeet("1 person reacted")).toBe("1 P3250N 234C73D");
  });

  test("enchantment", () => {
    expect(encodeEnchantment("Accept friend request")).toBe(
      "ᔑᓵᓵᒷ!¡ℸ ⎓∷╎ᒷリ↸ ∷ᒷᑑ⚍ᒷᓭℸ",
    );
    expect(encodeEnchantment("Text")).toBe("ℸᒷ/ℸ");
  });

  test("piglatin", () => {
    expect(encodePigLatin("1 person reacted")).toBe("1 ersonpay eactedray");
    expect(encodePigLatin("Add friend")).toBe("Addyay iendfray");
    expect(encodePigLatin("Block user.")).toBe("Ockblay useryay.");
    expect(encodePigLatin("Messages")).toBe("Essagesmay");
    expect(encodePigLatin("don't")).toBe("on'tday");
  });

  test("bottom", () => {
    expect(encodeBottom("A")).toBe("💖✨🥺👉👈");
    expect(encodeBottom("1 person reacted")).toBe(
      "✨✨✨✨🥺,,,,👉👈✨✨✨,,👉👈💖💖✨,,👉👈💖💖,👉👈💖💖✨,,,,👉👈💖💖✨🥺👉👈💖💖✨,👉👈💖💖✨👉👈✨✨✨,,👉👈💖💖✨,,,,👉👈💖💖,👉👈💖✨✨✨✨🥺,,👉👈💖✨✨✨✨🥺,,,,👉👈💖💖✨🥺,👉👈💖💖,👉👈💖💖👉👈",
    );
  });
});

describe("encodeForLocale", () => {
  test("keeps simple placeholders and tags", () => {
    expect(encodeForLocale("Hi {name}, <0>click</0> <1/>", "leet")).toBe(
      "H1 {name}, <0>CL1CK</0> <1/>",
    );
  });

  test("keeps plural syntax and encodes the branches", () => {
    expect(
      encodeForLocale(
        "{0, plural, one {# blocked message} other {# blocked messages}}",
        "leet",
      ),
    ).toBe("{0, plural, one {# 8L0CK3D M355463} other {# 8L0CK3D M3554635}}");
  });

  test("keeps nested placeholders in plural branches", () => {
    expect(
      encodeForLocale(
        "{0, plural, one {# freeze, {seconds} s} other {# freezes}}",
        "piglatin",
      ),
    ).toBe("{0, plural, one {# eezefray, {seconds} say} other {# eezesfray}}");
  });

  test("encodes only inside dayjs brackets", () => {
    expect(encodeForLocale("[Last] dddd [at] LT", "leet")).toBe(
      "[L457] dddd [47] LT",
    );
  });
});
