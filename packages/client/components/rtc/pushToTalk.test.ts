import { describe, expect, it } from "vitest";

import { micShouldBeOn, pttHeld } from "./pushToTalk";

const base = {
  speak: true,
  deafen: false,
  micOn: true,
  mode: "voice" as const,
  pttOpen: false,
};

describe("micShouldBeOn", () => {
  it("is on with voice activity", () => {
    expect(micShouldBeOn(base)).toBe(true);
  });

  it("is off in push to talk until the key is held", () => {
    expect(micShouldBeOn({ ...base, mode: "ptt" })).toBe(false);
    expect(micShouldBeOn({ ...base, mode: "ptt", pttOpen: true })).toBe(true);
  });

  it("stays off when muted, deafened or not allowed to speak", () => {
    const ptt = { ...base, mode: "ptt" as const, pttOpen: true };
    expect(micShouldBeOn({ ...ptt, micOn: false })).toBe(false);
    expect(micShouldBeOn({ ...ptt, deafen: true })).toBe(false);
    expect(micShouldBeOn({ ...ptt, speak: false })).toBe(false);
    expect(micShouldBeOn({ ...base, micOn: false })).toBe(false);
  });
});

describe("pttHeld", () => {
  it("is held while any source holds it", () => {
    expect(pttHeld({ keys: false, pad: false })).toBe(false);
    expect(pttHeld({ keys: true, pad: false })).toBe(true);
    expect(pttHeld({ keys: false, pad: true })).toBe(true);
    expect(pttHeld({ keys: true, pad: true })).toBe(true);
  });
});
