import { describe, expect, it } from "vitest";

import { crc32, zipFiles } from "./zip";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(bytes(""))).toBe(0);
  });
});

describe("zipFiles", () => {
  it("stores every file with a central directory", () => {
    const zip = zipFiles([
      { name: "a.csv", text: "seconds\n1.0" },
      { name: "ü.csv", text: "x" },
    ]);
    const view = new DataView(zip.buffer);

    // first local header, stored, with the file name and data after it
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe("a.csv");
    expect(new TextDecoder().decode(zip.slice(35, 46))).toBe("seconds\n1.0");

    // end of central directory lists both files
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);

    const centralStart = view.getUint32(end + 16, true);
    expect(view.getUint32(centralStart, true)).toBe(0x02014b50);
    expect(view.getUint32(centralStart + 16, true)).toBe(
      crc32(bytes("seconds\n1.0")),
    );
  });
});
