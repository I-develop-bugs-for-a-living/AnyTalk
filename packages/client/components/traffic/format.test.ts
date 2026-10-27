import { describe, expect, it } from "vitest";

import {
  fileStamp,
  formatBytes,
  formatDuration,
  tlsVersionName,
} from "./format";

describe("tlsVersionName", () => {
  it("names DTLS and TLS codes", () => {
    expect(tlsVersionName("FEFD")).toBe("DTLS 1.2");
    expect(tlsVersionName("fefc")).toBe("DTLS 1.3");
    expect(tlsVersionName("FEFF")).toBe("DTLS 1.0");
    expect(tlsVersionName("0304")).toBe("TLS 1.3");
  });

  it("returns unknown codes as they are", () => {
    expect(tlsVersionName("ABCD")).toBe("ABCD");
    expect(tlsVersionName(undefined)).toBeUndefined();
  });
});

describe("formatBytes", () => {
  it("scales and handles unknown sizes", () => {
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.5 kB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
  });
});

describe("formatDuration", () => {
  it("formats ms and seconds", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(120.4)).toBe("120 ms");
    expect(formatDuration(2400)).toBe("2.4 s");
  });
});

describe("fileStamp", () => {
  it("is sortable and safe in file names", () => {
    expect(fileStamp(new Date(2026, 9, 7, 4, 5, 6))).toBe(
      "2026-10-07_04-05-06",
    );
  });
});
