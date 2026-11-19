import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loopbackFor, sourceAudio } from "./screenAudio.ts";

describe("sourceAudio", () => {
  it("restricts nothing off Windows", () => {
    assert.equal(sourceAudio("linux", "window:1:0", false), undefined);
    assert.equal(sourceAudio("darwin", "screen:0:0", false), undefined);
  });

  it("gives screens loopback and any window loopback without the add-on", () => {
    assert.equal(sourceAudio("win32", "screen:0:0", false), "screen");
    assert.equal(sourceAudio("win32", "window:1:0", false), "game");
    assert.equal(sourceAudio("win32", "foo:1", false), "game");
  });

  it("shares no sound from AnyTalk's own windows", () => {
    assert.equal(sourceAudio("win32", "window:1:0", true), "none");
  });
});

describe("loopbackFor", () => {
  it("gives loopback for screens and windows on Windows", () => {
    assert.equal(loopbackFor("win32", true, "screen:0:0", false), "loopback");
    assert.equal(loopbackFor("win32", true, "window:1:0", false), "loopback");
  });

  it("gives nothing for our own windows", () => {
    assert.equal(loopbackFor("win32", true, "window:1:0", true), undefined);
  });

  it("gives nothing when not wanted or off Windows", () => {
    assert.equal(loopbackFor("win32", false, "screen:0:0", false), undefined);
    assert.equal(loopbackFor("linux", true, "screen:0:0", false), undefined);
  });
});

describe("per-process capture", () => {
  const own = [10, 11];
  const app = (pid: number | undefined, uwpHost = false) => ({
    pid,
    ownPids: own,
    uwpHost,
  });

  it("gives windows their own app sound", () => {
    assert.equal(sourceAudio("win32", "window:1:0", false, app(50)), "app");
  });

  it("keeps screens on loopback", () => {
    assert.equal(sourceAudio("win32", "screen:0:0", false, app(50)), "screen");
  });

  it("shares no sound from AnyTalk's own process", () => {
    assert.equal(sourceAudio("win32", "window:1:0", false, app(11)), "none");
  });

  it("falls back to loopback without a process id", () => {
    assert.equal(
      sourceAudio("win32", "window:1:0", false, app(undefined)),
      "game",
    );
  });

  it("falls back to loopback for UWP windows", () => {
    assert.equal(
      sourceAudio("win32", "window:1:0", false, app(50, true)),
      "game",
    );
  });

  it("never uses loopback for an app window", () => {
    assert.equal(
      loopbackFor("win32", true, "window:1:0", false, app(50)),
      undefined,
    );
    assert.equal(
      loopbackFor("win32", true, "window:1:0", false, app(50, true)),
      "loopback",
    );
    assert.equal(
      loopbackFor("win32", true, "screen:0:0", false, app(50)),
      "loopback",
    );
  });
});
