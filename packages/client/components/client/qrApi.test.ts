import { describe, expect, it } from "vitest";

import { shouldDenyOnClose } from "./qrApi";

describe("shouldDenyOnClose", () => {
  it("denies a request that was dismissed unanswered", () => {
    expect(shouldDenyOnClose(false, false)).toBe(true);
  });

  it("does not deny after an answer", () => {
    expect(shouldDenyOnClose(true, false)).toBe(false);
  });

  it("does not deny a request that is gone", () => {
    expect(shouldDenyOnClose(false, true)).toBe(false);
  });
});
