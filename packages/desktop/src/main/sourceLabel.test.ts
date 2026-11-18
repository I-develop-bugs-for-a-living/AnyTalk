import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LABEL_MAX_LENGTH,
  chooseLabel,
  parseProgramInfo,
  parseWmClass,
  presentableName,
  sanitizeLabel,
} from "./sourceLabel.ts";

describe("sanitizeLabel", () => {
  it("collapses white space and removes control characters", () => {
    assert.equal(sanitizeLabel("  a\u0000b \n c "), "a b c");
  });
  it("caps the length", () => {
    assert.equal(sanitizeLabel("x".repeat(200))?.length, LABEL_MAX_LENGTH);
  });
  it("gives undefined for empty or non-text", () => {
    assert.equal(sanitizeLabel("  "), undefined);
    assert.equal(sanitizeLabel(5), undefined);
  });
});

describe("presentableName", () => {
  it("strips .exe and capitalises", () => {
    assert.equal(presentableName("firefox.exe"), "Firefox");
    assert.equal(presentableName("my_game"), "My game");
  });
  it("keeps mixed case", () => {
    assert.equal(presentableName("VLC.exe"), "VLC");
  });
});

describe("chooseLabel", () => {
  it("prefers the description, then the product", () => {
    assert.equal(
      chooseLabel({ name: "ff", description: "Firefox", product: "P" }),
      "Firefox",
    );
    assert.equal(chooseLabel({ name: "ff", product: "Prod" }), "Prod");
  });
  it("falls back to the readable process name", () => {
    assert.equal(chooseLabel({ name: "firefox.exe" }), "Firefox");
    assert.equal(chooseLabel({ name: "x", description: "a.exe" }), "X");
  });
  it("gives no label without process info", () => {
    assert.equal(chooseLabel(undefined), undefined);
    assert.equal(chooseLabel({}), undefined);
  });
  it("gives no label for generic hosts, never the title", () => {
    assert.equal(
      chooseLabel({
        name: "ApplicationFrameHost",
        description: "Application Frame Host",
      }),
      undefined,
    );
    assert.equal(chooseLabel({ name: "RuntimeBroker" }), undefined);
  });
});

describe("parsers", () => {
  it("reads the lookup output", () => {
    assert.deepEqual(parseProgramInfo('{"n":"a","d":"B","p":""}'), {
      name: "a",
      description: "B",
      product: undefined,
    });
    assert.equal(parseProgramInfo("nope"), undefined);
  });
  it("reads WM_CLASS", () => {
    assert.equal(
      parseWmClass('WM_CLASS(STRING) = "Navigator", "firefox"'),
      "firefox",
    );
    assert.equal(parseWmClass("not found"), undefined);
  });
});
