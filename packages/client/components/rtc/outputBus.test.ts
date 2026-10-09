import { describe, expect, it } from "vitest";

import {
  findEarpiece,
  isIOSAgent,
  isSafariBasedAgent,
  pickSinkId,
} from "./outputBus";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("isSafariBasedAgent", () => {
  it("detects Safari on iPhone and Mac", () => {
    expect(isSafariBasedAgent(IPHONE)).toBe(true);
    expect(isSafariBasedAgent(MAC_SAFARI, "MacIntel", 0)).toBe(true);
  });

  it("treats every iOS browser as Safari-based", () => {
    expect(isSafariBasedAgent(IPHONE_CHROME)).toBe(true);
  });

  it("detects iPadOS posing as a Mac", () => {
    expect(isSafariBasedAgent(CHROME, "MacIntel", 5)).toBe(true);
  });

  it("ignores Chromium based browsers", () => {
    expect(isSafariBasedAgent(CHROME, "Linux x86_64", 0)).toBe(false);
    expect(isSafariBasedAgent(ANDROID, "Linux armv8l", 5)).toBe(false);
  });
});

describe("pickSinkId", () => {
  it("uses the default when nothing is chosen", () => {
    expect(pickSinkId(undefined)).toBe("");
    expect(pickSinkId("default")).toBe("");
  });

  it("keeps a chosen device", () => {
    expect(pickSinkId("b")).toBe("b");
  });
});

describe("isIOSAgent", () => {
  it("detects iPhone and iPadOS but not Mac or Android", () => {
    expect(isIOSAgent(IPHONE)).toBe(true);
    expect(isIOSAgent(MAC_SAFARI, "MacIntel", 5)).toBe(true);
    expect(isIOSAgent(MAC_SAFARI, "MacIntel", 0)).toBe(false);
    expect(isIOSAgent(ANDROID, "Linux armv8l", 5)).toBe(false);
  });
});

describe("findEarpiece", () => {
  const dev = (deviceId: string, label: string) => ({ deviceId, label });

  it("finds the German receiver", () => {
    const list = [
      dev("default", "Standard - Empfänger"),
      dev("a", "Lautsprecher"),
      dev("b", "Empfänger"),
    ];
    expect(findEarpiece(list)?.deviceId).toBe("b");
  });

  it("finds the English receiver", () => {
    const list = [
      dev("default", "Default"),
      dev("a", "Speaker"),
      dev("b", "Receiver"),
    ];
    expect(findEarpiece(list)?.deviceId).toBe("b");
  });

  it("never picks the default entry", () => {
    expect(findEarpiece([dev("default", "Receiver")])).toBeUndefined();
  });

  it("falls back to the entry after the speaker", () => {
    const list = [
      dev("default", "x"),
      dev("a", "Haut-parleur"),
      dev("b", "Écouteur"),
    ];
    expect(findEarpiece(list)?.deviceId).toBe("b");
  });

  it("does not guess when Bluetooth comes first or entries are missing", () => {
    expect(
      findEarpiece([dev("default", "x"), dev("a", "AirPods"), dev("b", "Foo")]),
    ).toBeUndefined();
    expect(
      findEarpiece([dev("default", "x"), dev("a", "Foo")]),
    ).toBeUndefined();
  });
});
