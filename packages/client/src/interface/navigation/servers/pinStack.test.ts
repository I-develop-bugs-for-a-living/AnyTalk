import { describe, expect, it } from "vitest";

import { aggregatePinBadges, shouldStackPins } from "./pinStack";

describe("shouldStackPins", () => {
  it("stacks from three pins", () => {
    expect(shouldStackPins(0)).toBe(false);
    expect(shouldStackPins(2)).toBe(false);
    expect(shouldStackPins(3)).toBe(true);
    expect(shouldStackPins(10)).toBe(true);
  });
});

describe("aggregatePinBadges", () => {
  it("is empty without chats", () => {
    expect(aggregatePinBadges([])).toEqual({ mentions: 0, unread: false });
  });

  it("sums mentions and flags unread", () => {
    expect(
      aggregatePinBadges([
        { unread: true, mentions: 2 },
        { unread: false, mentions: 0 },
        { unread: true, mentions: 3 },
      ]),
    ).toEqual({ mentions: 5, unread: true });
  });

  it("reports unread without mentions", () => {
    expect(aggregatePinBadges([{ unread: true, mentions: 0 }])).toEqual({
      mentions: 0,
      unread: true,
    });
  });
});
