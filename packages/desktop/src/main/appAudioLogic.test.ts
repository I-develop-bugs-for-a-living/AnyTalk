import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isUwpHost,
  supportsProcessLoopback,
  windowHandleFromSourceId,
  windowsBuildFromRelease,
} from "./appAudioLogic.ts";

describe("windowHandleFromSourceId", () => {
  it("reads the handle of a window id", () => {
    assert.equal(windowHandleFromSourceId("window:263538:0"), 263538n);
  });

  it("keeps handles above 32 bits exact", () => {
    assert.equal(
      windowHandleFromSourceId("window:18446744073709551:0"),
      18446744073709551n,
    );
  });

  it("rejects screens and malformed ids", () => {
    assert.equal(windowHandleFromSourceId("screen:0:0"), undefined);
    assert.equal(windowHandleFromSourceId("window:abc:0"), undefined);
    assert.equal(windowHandleFromSourceId("window:0:0"), undefined);
    assert.equal(windowHandleFromSourceId("window:12"), undefined);
  });
});

describe("windowsBuildFromRelease", () => {
  it("reads the build number", () => {
    assert.equal(windowsBuildFromRelease("10.0.22631"), 22631);
  });

  it("returns undefined for other strings", () => {
    assert.equal(windowsBuildFromRelease("6.8.0-arch1"), 0);
    assert.equal(windowsBuildFromRelease("weird"), undefined);
  });
});

describe("supportsProcessLoopback", () => {
  it("needs Windows build 20348 or newer", () => {
    assert.equal(supportsProcessLoopback("win32", "10.0.19045"), false);
    assert.equal(supportsProcessLoopback("win32", "10.0.20348"), true);
    assert.equal(supportsProcessLoopback("win32", "10.0.26100"), true);
  });

  it("is false off Windows or for unreadable versions", () => {
    assert.equal(supportsProcessLoopback("linux", "10.0.26100"), false);
    assert.equal(supportsProcessLoopback("win32", "weird"), false);
  });
});

describe("isUwpHost", () => {
  it("recognises the UWP frame host in any case", () => {
    assert.equal(isUwpHost("ApplicationFrameHost.exe"), true);
    assert.equal(isUwpHost("applicationframehost.EXE"), true);
  });

  it("is false for other programs", () => {
    assert.equal(isUwpHost("chrome.exe"), false);
    assert.equal(isUwpHost(undefined), false);
  });
});
