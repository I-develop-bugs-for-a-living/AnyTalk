import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tlsKeyLogStartup } from "./tlsKeyLogLogic.ts";

describe("tlsKeyLogStartup", () => {
  it("stays off when the setting is off", () => {
    assert.equal(tlsKeyLogStartup(false, "", "1.0.0"), "off");
    assert.equal(tlsKeyLogStartup(false, "0.9.0", "1.0.0"), "off");
  });

  it("writes keys in the version it was switched on in", () => {
    assert.equal(tlsKeyLogStartup(true, "1.0.0", "1.0.0"), "on");
  });

  it("resets after an update", () => {
    assert.equal(tlsKeyLogStartup(true, "0.9.0", "1.0.0"), "reset");
    assert.equal(tlsKeyLogStartup(true, "", "1.0.0"), "reset");
  });
});
