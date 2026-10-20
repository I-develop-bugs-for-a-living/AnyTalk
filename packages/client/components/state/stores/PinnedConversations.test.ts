import { describe, expect, it } from "vitest";

import { PinnedConversations } from "./PinnedConversations";

/**
 * Run a store method against a fake store holding the given value
 * @param value Stored value
 */
function fake(value: unknown) {
  return { get: () => value } as unknown as PinnedConversations;
}

describe("PinnedConversations.clean", () => {
  const clean = (input: unknown) =>
    PinnedConversations.prototype.clean.call(
      fake(undefined),
      input as Parameters<PinnedConversations["clean"]>[0],
    );

  it("drops a non-boolean collapsed value", () => {
    expect(clean({ ids: ["a"], collapsed: "yes" })).toEqual({ ids: ["a"] });
  });

  it("keeps false and true", () => {
    expect(clean({ ids: [], collapsed: false })).toEqual({
      ids: [],
      collapsed: false,
    });
    expect(clean({ ids: [], collapsed: true }).collapsed).toBe(true);
  });
});

describe("PinnedConversations.isCollapsed", () => {
  it("defaults to collapsed", () => {
    expect(
      PinnedConversations.prototype.isCollapsed.call(fake({ ids: [] })),
    ).toBe(true);
  });

  it("follows an explicit false", () => {
    expect(
      PinnedConversations.prototype.isCollapsed.call(
        fake({ ids: [], collapsed: false }),
      ),
    ).toBe(false);
  });
});
