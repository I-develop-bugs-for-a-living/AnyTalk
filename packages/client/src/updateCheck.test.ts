import { describe, expect, it } from "vitest";

import { findEntryScript, isNewBuild } from "./updateCheck";

describe("findEntryScript", () => {
  it("finds the hashed entry script", () => {
    const html =
      '<head><script type="module" crossorigin src="/assets/index-Ab_12-x.js"></script></head>';
    expect(findEntryScript(html)).toBe("/assets/index-Ab_12-x.js");
  });

  it("returns undefined without one", () => {
    expect(findEntryScript('<script src="/src/index.tsx"></script>')).toBe(
      undefined,
    );
  });
});

describe("isNewBuild", () => {
  it("detects a different hash", () => {
    expect(isNewBuild("/assets/index-a.js", "/assets/index-b.js")).toBe(true);
  });

  it("ignores the same build", () => {
    expect(isNewBuild("/assets/index-a.js", "/assets/index-a.js")).toBe(false);
  });

  it("ignores unknown values", () => {
    expect(isNewBuild(undefined, "/assets/index-b.js")).toBe(false);
    expect(isNewBuild("/assets/index-a.js", undefined)).toBe(false);
  });
});
