import { describe, expect, it } from "vitest";

import { parseRecapCsv, splitCsvLine } from "./recapCsv";

describe("splitCsvLine", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("1,2,,4")).toEqual(["1", "2", "", "4"]);
  });

  it("reads JSON quoted names with commas and quotes", () => {
    expect(splitCsvLine('"Ann, \\"A\\"",sending,1.0')).toEqual([
      'Ann, "A"',
      "sending",
      "1.0",
    ]);
  });

  it("reads standard CSV quoting", () => {
    expect(splitCsvLine('"say ""hi""",2')).toEqual(['say "hi"', "2"]);
  });

  it("keeps a trailing empty field", () => {
    expect(splitCsvLine('"a",')).toEqual(["a", ""]);
  });
});

describe("parseRecapCsv", () => {
  it("parses a call recap into one line per microphone", () => {
    const csv = [
      "participant,direction,seconds,bitrate,lost,quality",
      '"You",sending,1.0,32000,0,3',
      '"Bob, Jr.",receiving,1.0,30000,1,2',
      '"You",sending,2.0,31000,,3',
      '"Bob, Jr.",receiving,2.0,29000,0,',
    ].join("\n");

    const parsed = parseRecapCsv(csv);
    if ("error" in parsed) throw new Error(parsed.error);

    expect(parsed.kind).toBe("call");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      label: "You's microphone",
      direction: "sending",
    });
    expect(parsed.lines[0].rows).toEqual([
      { t: 1000, bitrate: 32000, lost: 0, quality: 3 },
      { t: 2000, bitrate: 31000, quality: 3 },
    ]);
    expect(parsed.lines[1]).toMatchObject({
      label: "Bob, Jr. heard",
      direction: "receiving",
    });
    expect(parsed.lines[1].rows[1]).toEqual({
      t: 2000,
      bitrate: 29000,
      lost: 0,
    });
  });

  it("parses a sent stream recap and skips text columns", () => {
    const csv = [
      "seconds,bitrate,targetBitrate,fps,limitation",
      "0.0,1000000,1200000,30,none",
      "1.0,900000,1200000,29,bandwidth",
    ].join("\r\n");

    const parsed = parseRecapCsv(csv);
    if ("error" in parsed) throw new Error(parsed.error);

    expect(parsed.kind).toBe("stream");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].direction).toBe("sending");
    expect(parsed.lines[0].label).toBe("Sent stream");
    expect(parsed.lines[0].rows[1]).toEqual({
      t: 1000,
      bitrate: 900000,
      targetBitrate: 1200000,
      fps: 29,
    });
  });

  it("tells a watched stream by its columns", () => {
    const parsed = parseRecapCsv("seconds,fps,dropped\n0.0,30,0\n");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.lines[0].direction).toBe("receiving");
  });

  it("rejects files that aren't recaps", () => {
    expect(parseRecapCsv("name,age\nBob,3")).toEqual({
      error: "Not a recap CSV: there is no seconds column.",
    });
    expect(parseRecapCsv("seconds,fps\n")).toEqual({
      error: "The file has no samples.",
    });
  });
});
