import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JAVA_TITLE_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  chooseLabel,
  encodePowerShell,
  isJavaProgram,
  parseProgramInfo,
  parseWmClass,
  presentableName,
  processNameByTitle,
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

describe("java programs", () => {
  const javaw = { name: "javaw", description: "OpenJDK Platform binary" };
  it("detects runtimes by process name or description", () => {
    assert.equal(isJavaProgram({ name: "javaw.exe" }), true);
    assert.equal(isJavaProgram({ name: "JAVA" }), true);
    assert.equal(
      isJavaProgram({ name: "x", description: "Java(TM) Platform SE binary" }),
      true,
    );
    assert.equal(isJavaProgram({ name: "firefox" }), false);
  });
  it("uses the window title", () => {
    assert.equal(
      chooseLabel(javaw, "GT: New Horizons 2.8.1"),
      "GT: New Horizons 2.8.1",
    );
  });
  it("truncates long titles with an ellipsis", () => {
    const label = chooseLabel(javaw, "x".repeat(200));
    assert.equal(label?.length, JAVA_TITLE_MAX_LENGTH);
    assert.equal(label?.endsWith("\u2026"), true);
  });
  it("cuts a 60 character title to 47 characters and an ellipsis", () => {
    const title = "a".repeat(30) + "b".repeat(30);
    assert.equal(
      chooseLabel(javaw, title),
      "a".repeat(30) + "b".repeat(17) + "\u2026",
    );
  });
  it("does not treat other platform binaries as Java", () => {
    assert.equal(
      isJavaProgram({ name: "x", description: "Some Platform binary" }),
      false,
    );
    assert.equal(isJavaProgram({ name: "java-lang-Thread" }), true);
  });
  it("falls back to Java without a title", () => {
    assert.equal(chooseLabel(javaw, ""), "Java");
    assert.equal(chooseLabel(javaw, undefined), "Java");
  });
  it("still ignores the title for other programs", () => {
    assert.equal(
      chooseLabel({ name: "ff", description: "Firefox" }, "Secret page"),
      "Firefox",
    );
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

describe("encodePowerShell", () => {
  it("encodes as base64 UTF-16LE", () => {
    assert.equal(encodePowerShell("a"), "YQA=");
  });
});

describe("processNameByTitle", () => {
  const row = (name: string, title: string) =>
    `"${name}","1","Console","1","10 K","Running","u","0:00:01","${title}"`;
  it("finds the process by exact title", () => {
    const out = [
      row("javaw.exe", "GT: New Horizons 2.8.1"),
      row("a.exe", "N/A"),
    ].join("\r\n");
    assert.equal(
      processNameByTitle(out, "GT: New Horizons 2.8.1"),
      "javaw.exe",
    );
  });
  it("gives nothing for no match, empty title or ambiguity", () => {
    const out = [row("a.exe", "T"), row("b.exe", "T")].join("\n");
    assert.equal(processNameByTitle(out, "T"), undefined);
    assert.equal(processNameByTitle(out, "X"), undefined);
    assert.equal(processNameByTitle(out, " "), undefined);
  });
});
