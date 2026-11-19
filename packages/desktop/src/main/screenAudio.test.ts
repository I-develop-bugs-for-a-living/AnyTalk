import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loopbackFor, sourceAudio } from "./screenAudio.ts";

describe("sourceAudio", () => {
  it("restricts nothing off Windows", () => {
    assert.equal(sourceAudio("linux", "window:1:0", false), undefined);
    assert.equal(sourceAudio("darwin", "screen:0:0", false), undefined);
  });

  it("classifies screens, games and other windows on Windows", () => {
    assert.equal(sourceAudio("win32", "screen:0:0", false), "screen");
    assert.equal(sourceAudio("win32", "window:1:0", true), "game");
    assert.equal(sourceAudio("win32", "window:1:0", false), "none");
    assert.equal(sourceAudio("win32", "foo:1", false), "none");
  });
});

describe("loopbackFor", () => {
  it("gives loopback for screens and games on Windows", () => {
    assert.equal(loopbackFor("win32", true, "screen:0:0", false), "loopback");
    assert.equal(loopbackFor("win32", true, "window:1:0", true), "loopback");
  });

  it("never gives loopback for a non-game window", () => {
    assert.equal(loopbackFor("win32", true, "window:1:0", false), undefined);
    assert.equal(loopbackFor("win32", true, "foo:1", false), undefined);
  });

  it("gives nothing when not wanted or off Windows", () => {
    assert.equal(loopbackFor("win32", false, "screen:0:0", false), undefined);
    assert.equal(loopbackFor("linux", true, "screen:0:0", false), undefined);
  });
});
