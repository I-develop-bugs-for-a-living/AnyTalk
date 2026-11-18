import { describe, expect, it } from "vitest";

import {
  STREAM_APP_ATTRIBUTE,
  STREAM_APP_MAX_LENGTH,
  sanitizeStreamApp,
  streamAppOf,
} from "./streamApp";

describe("sanitizeStreamApp", () => {
  it("collapses white space and control characters", () => {
    expect(sanitizeStreamApp("  Elden \n\u0000 Ring ")).toBe("Elden Ring");
  });

  it("caps the length", () => {
    expect(sanitizeStreamApp("x".repeat(500))?.length).toBe(
      STREAM_APP_MAX_LENGTH,
    );
  });

  it("gives undefined for empty or non-text values", () => {
    expect(sanitizeStreamApp("   ")).toBeUndefined();
    expect(sanitizeStreamApp(undefined)).toBeUndefined();
    expect(sanitizeStreamApp(3)).toBeUndefined();
  });
});

describe("streamAppOf", () => {
  it("reads the attribute", () => {
    expect(streamAppOf({ [STREAM_APP_ATTRIBUTE]: "Firefox" })).toBe("Firefox");
  });

  it("is undefined when cleared or missing", () => {
    expect(streamAppOf({ [STREAM_APP_ATTRIBUTE]: "" })).toBeUndefined();
    expect(streamAppOf({})).toBeUndefined();
    expect(streamAppOf(undefined)).toBeUndefined();
  });
});
