import { describe, expect, it } from "vitest";

import { crc32, unzipFiles, zipFiles } from "./zip";

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

describe("unzipFiles", () => {
  const text = (data: Uint8Array) => new TextDecoder().decode(data);

  it("reads back what zipFiles wrote", async () => {
    const files = await unzipFiles(
      zipFiles([
        { name: "a.csv", text: "seconds\n1.0" },
        { name: "ü.csv", text: "x" },
      ]),
    );
    expect(files.map((f) => [f.name, text(f.data)])).toEqual([
      ["a.csv", "seconds\n1.0"],
      ["ü.csv", "x"],
    ]);
  });

  it("reads deflated zips from other tools and skips folders", async () => {
    // made by Python's zipfile with ZIP_DEFLATED: a folder and one CSV
    const zip = Uint8Array.from(
      atob(
        "UEsDBBQAAAgIAPUqQ117OOokQgAAALoAAAAYAAAAcmVjYXBzL2NhbGwtcmVjYXAtw6QuY3N2xcvBDYAwCAXQe8fomRi0EzhKBWK4/BLK/nEM3/3FzHLxmChST5PyBdomC7rp8cpZ1voNdNoGdbx0HkzjYuYWP+4PUEsDBBQAAAAIAPUqQ10AAAAAAgAAAAAAAAAHAAAAcmVjYXBzLwMAUEsBAhQDFAAACAgA9SpDXXs46iRCAAAAugAAABgAAAAAAAAAAAAAAIABAAAAAHJlY2Fwcy9jYWxsLXJlY2FwLcOkLmNzdlBLAQIUAxQAAAAIAPUqQ10AAAAAAgAAAAAAAAAHAAAAAAAAAAAAEAD9QXgAAAByZWNhcHMvUEsFBgAAAAACAAIAewAAAJ8AAAAAAA==",
      ),
      (c) => c.charCodeAt(0),
    );

    const files = await unzipFiles(zip);
    expect(files.map((f) => f.name)).toEqual(["recaps/call-recap-ä.csv"]);
    expect(text(files[0].data)).toBe(
      'participant,direction,seconds,bitrate\n"Ann",sending,1.0,32000\n'.repeat(
        3,
      ),
    );
  });

  it("rejects files that aren't zips", async () => {
    await expect(
      unzipFiles(new TextEncoder().encode("seconds\n")),
    ).rejects.toThrow("Not a zip file");
  });
});
