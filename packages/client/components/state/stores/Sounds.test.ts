import { describe, expect, it } from "vitest";

import type { State } from "..";

import { SOUND_NAMES, Sounds } from "./Sounds";

const store = new Sounds({} as State);

describe("Sounds.clean", () => {
  it("turns every sound on by default", () => {
    const clean = store.clean({});
    for (const name of SOUND_NAMES) expect(clean[name]).toBe(true);
    expect(clean).toMatchObject({
      playSounds: true,
      volume: 1,
      volumes: {},
      custom: {},
    });
  });

  it("keeps settings saved before advanced sound settings existed", () => {
    const clean = store.clean({ mute: false, volume: 0.4 } as never);
    expect(clean.mute).toBe(false);
    expect(clean.unmute).toBe(true);
    expect(clean.volume).toBe(0.4);
  });

  it("keeps valid per-sound settings and drops the rest", () => {
    const clean = store.clean({
      playSounds: false,
      volume: 7,
      volumes: { mute: 0.5, deafen: 2, unmute: "loud", nope: 0.3 },
      custom: { message: "ping.ogg", mute: 3 },
    } as never);

    expect(clean.playSounds).toBe(false);
    expect(clean.volume).toBe(1);
    expect(clean.volumes).toEqual({ mute: 0.5, deafen: 1 });
    expect(clean.custom).toEqual({ message: "ping.ogg" });
  });
});
