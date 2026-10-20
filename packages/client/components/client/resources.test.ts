import { describe, expect, it, vi } from "vitest";

import { fetchProfile } from "./resources";

vi.mock("stoat.js", () => ({
  UserProfile: class {
    content?: string;
    constructor(_client: unknown, data: { content?: string }) {
      this.content = data.content;
    }
  },
}));

vi.mock(".", () => ({ useClient: () => () => ({}) }));

/** Fake client whose profile endpoint returns the given data */
function fakeClient(data: object) {
  return { api: { get: vi.fn().mockResolvedValue(data) } } as never;
}

describe("fetchProfile", () => {
  it("keeps a numeric banner_hue", async () => {
    const profile = await fetchProfile(fakeClient({ banner_hue: 210 }), {
      id: "u1",
    } as never);
    expect(profile.bannerHue).toBe(210);
  });

  it("leaves bannerHue unset without the field or with another type", async () => {
    for (const data of [{}, { banner_hue: "210" }, { banner_hue: null }]) {
      const profile = await fetchProfile(fakeClient(data), {
        id: "u1",
      } as never);
      expect(profile.bannerHue).toBeUndefined();
    }
  });
});
