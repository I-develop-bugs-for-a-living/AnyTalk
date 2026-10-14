import { describe, expect, it } from "vitest";

import { pickUpdateNotice } from "./updaterState";

describe("pickUpdateNotice", () => {
  it("shows nothing without updates", () => {
    expect(pickUpdateNotice(false, false)).toBeUndefined();
  });

  it("shows the web card for a web update only", () => {
    expect(pickUpdateNotice(false, true)).toBe("web");
  });

  it("shows the desktop card for a desktop update only", () => {
    expect(pickUpdateNotice(true, false)).toBe("desktop");
  });

  it("prefers the desktop card when both exist", () => {
    expect(pickUpdateNotice(true, true)).toBe("desktop");
  });
});
