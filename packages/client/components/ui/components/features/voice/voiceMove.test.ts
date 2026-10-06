import { describe, expect, test } from "vitest";

import type { Channel } from "stoat.js";

import { canMoveTo, findVoiceChannelOf, moveTargets } from "./voiceMove";

/** Minimal fake voice channel */
const channel = (
  id: string,
  opts: Partial<{
    voice: boolean;
    server: string;
    perm: boolean;
    users: string[];
  }> = {},
) =>
  ({
    id,
    isVoice: opts.voice ?? true,
    serverId: opts.server ?? "s1",
    server: opts.server === "" ? undefined : { id: opts.server ?? "s1" },
    havePermission: () => opts.perm ?? true,
    voiceParticipants: new Map((opts.users ?? []).map((u) => [u, {}])),
  }) as unknown as Channel;

describe("findVoiceChannelOf", () => {
  test("finds the voice channel the user is in", () => {
    const a = channel("a");
    const b = channel("b", { users: ["u"] });
    expect(findVoiceChannelOf([a, b], "u")).toBe(b);
  });

  test("returns undefined when they are in none", () => {
    expect(findVoiceChannelOf([channel("a")], "u")).toBeUndefined();
  });
});

describe("moveTargets", () => {
  test("lists other voice channels of the server with permission", () => {
    const from = channel("a", { users: ["u"] });
    const b = channel("b");
    const text = channel("t", { voice: false });
    const other = channel("o", { server: "s2" });
    const noPerm = channel("n", { perm: false });
    expect(moveTargets(from, [from, b, text, other, noPerm])).toEqual([b]);
  });

  test("is empty when they can't be moved out of their channel", () => {
    const from = channel("a", { perm: false });
    expect(moveTargets(from, [from, channel("b")])).toEqual([]);
    expect(canMoveTo(from, channel("b"))).toBe(false);
  });
});
