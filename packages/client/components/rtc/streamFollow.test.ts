import { describe, expect, it } from "vitest";

import {
  FOLLOW_ATTRIBUTE,
  FOLLOW_REPUBLISH_WAIT_MS,
  followCleared,
  isFollowing,
  republishWaitMs,
} from "./streamFollow";

describe("republishWaitMs", () => {
  it("uses the default without the attribute", () => {
    expect(republishWaitMs(undefined, 4000)).toBe(4000);
    expect(republishWaitMs({ deafened: "false" }, 4000)).toBe(4000);
  });

  it("treats an empty attribute as cleared", () => {
    expect(isFollowing({ [FOLLOW_ATTRIBUTE]: "" })).toBe(false);
  });

  it("waits longer while following", () => {
    expect(republishWaitMs({ [FOLLOW_ATTRIBUTE]: "1" }, 4000)).toBe(
      FOLLOW_REPUBLISH_WAIT_MS,
    );
  });
});

describe("followCleared", () => {
  it("ignores updates of other attributes", () => {
    expect(followCleared({ deafened: "true" }, {})).toBe(false);
    expect(followCleared(undefined, {})).toBe(false);
  });

  it("detects the attribute being cleared or removed", () => {
    expect(followCleared({ [FOLLOW_ATTRIBUTE]: "" }, {})).toBe(true);
    expect(followCleared({ [FOLLOW_ATTRIBUTE]: "" }, { a: "b" })).toBe(true);
  });

  it("ignores the attribute being set", () => {
    const attrs = { [FOLLOW_ATTRIBUTE]: "1" };
    expect(followCleared(attrs, attrs)).toBe(false);
  });
});
