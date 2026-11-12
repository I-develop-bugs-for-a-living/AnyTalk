import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type PidCacheEntry,
  needsCmdline,
  nextScanDelay,
  prunePidCache,
} from "./gameMatch.ts";

describe("prunePidCache", () => {
  it("drops vanished pids", () => {
    const cache = new Map<number, PidCacheEntry>([
      [1, { comm: "a", names: ["a"] }],
      [2, { comm: "b", names: ["b"] }],
    ]);
    prunePidCache(cache, [2, 3]);
    assert.deepEqual([...cache.keys()], [2]);
  });
});

describe("needsCmdline", () => {
  it("reads cmdline for new pids and changed comm only", () => {
    const known = { comm: "wrapper", names: ["wrapper"] };
    assert.equal(needsCmdline(undefined, "x"), true);
    assert.equal(needsCmdline(known, "game.exe"), true);
    assert.equal(needsCmdline(known, "wrapper"), false);
  });
});

describe("nextScanDelay", () => {
  it("scans fast while a game runs, even with a hidden window", () => {
    assert.equal(nextScanDelay(true, true), 3_000);
    assert.equal(nextScanDelay(true, false), 3_000);
  });

  it("backs off when idle and hidden", () => {
    assert.equal(nextScanDelay(false, false), 5_000);
    assert.equal(nextScanDelay(false, true), 30_000);
  });
});
