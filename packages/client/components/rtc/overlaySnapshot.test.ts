import { describe, expect, it } from "vitest";

import {
  type OverlayParticipantState,
  buildOverlayState,
  sameOverlayState,
} from "./overlaySnapshot";

const alice: OverlayParticipantState = {
  id: "a",
  name: "Alice",
  speaking: false,
  streaming: false,
};
const bob: OverlayParticipantState = { ...alice, id: "b", name: "Bob" };

describe("buildOverlayState", () => {
  it("is empty outside a call", () => {
    expect(buildOverlayState(false, ["a"], { a: alice })).toEqual({
      inCall: false,
      participants: [],
    });
  });

  it("follows the given order and skips unknown ids", () => {
    const state = buildOverlayState(true, ["b", "x", "a"], {
      a: alice,
      b: bob,
    });
    expect(state.participants.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("sameOverlayState", () => {
  const base = { inCall: true, participants: [alice, bob] };

  it("treats equal snapshots as the same", () => {
    expect(
      sameOverlayState(base, { inCall: true, participants: [alice, bob] }),
    ).toBe(true);
  });

  it("notices speaking, streaming, avatar, name and order changes", () => {
    const changed = (p: OverlayParticipantState[]) =>
      sameOverlayState(base, { inCall: true, participants: p });
    expect(changed([{ ...alice, speaking: true }, bob])).toBe(false);
    expect(changed([{ ...alice, streaming: true }, bob])).toBe(false);
    expect(changed([{ ...alice, avatar: "https://x/y.png" }, bob])).toBe(false);
    expect(changed([{ ...alice, name: "Al" }, bob])).toBe(false);
    expect(changed([bob, alice])).toBe(false);
    expect(changed([alice])).toBe(false);
  });

  it("notices leaving the call", () => {
    expect(sameOverlayState(base, { inCall: false, participants: [] })).toBe(
      false,
    );
  });
});
