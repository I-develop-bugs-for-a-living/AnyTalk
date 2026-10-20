import { describe, expect, it } from "vitest";

import {
  aggregatePinBadges,
  shouldStackPins,
  splitPinPreview,
} from "./pinStack";

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

describe("splitPinPreview", () => {
  it("shows up to four chats without a counter", () => {
    expect(splitPinPreview([1, 2, 3])).toEqual({ shown: [1, 2, 3], hidden: 0 });
    expect(splitPinPreview([1, 2, 3, 4])).toEqual({
      shown: [1, 2, 3, 4],
      hidden: 0,
    });
  });

  it("gives the last slot to a counter from five chats", () => {
    expect(splitPinPreview([1, 2, 3, 4, 5])).toEqual({
      shown: [1, 2, 3],
      hidden: 2,
    });
    expect(splitPinPreview([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({
      shown: [1, 2, 3],
      hidden: 5,
    });
  });
});
