import { describe, expect, it, vi } from "vitest";

import {
  PREVIEW_CACHE_MS,
  PREVIEW_MISS_MS,
  createPreviewCache,
} from "./streamPreviewCache";

describe("createPreviewCache", () => {
  it("reuses a fresh preview and refetches a stale one", async () => {
    let time = 0;
    let n = 0;
    const load = vi.fn(async () => `blob:${++n}`);
    const revoke = vi.fn();
    const cache = createPreviewCache(() => time, revoke);

    expect(await cache.get("c", "u", load)).toBe("blob:1");
    expect(await cache.get("c", "u", load)).toBe("blob:1");
    expect(load).toHaveBeenCalledTimes(1);

    time = PREVIEW_CACHE_MS + 1;
    expect(await cache.get("c", "u", load)).toBe("blob:2");
    expect(revoke).toHaveBeenCalledWith("blob:1");
  });

  it("shares one request between simultaneous lookups", async () => {
    const load = vi.fn(async () => undefined);
    const cache = createPreviewCache(() => 0, vi.fn());
    await Promise.all([cache.get("c", "u", load), cache.get("c", "u", load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("treats errors as no preview", async () => {
    const cache = createPreviewCache(() => 0, vi.fn());
    const result = await cache.get("c", "u", async () => {
      throw new Error("x");
    });
    expect(result).toBeUndefined();
  });

  it("remembers a missing preview only briefly", async () => {
    let time = 0;
    const load = vi.fn(async () => undefined);
    const cache = createPreviewCache(() => time, vi.fn());
    await cache.get("c", "u", load);
    time = PREVIEW_MISS_MS - 1;
    await cache.get("c", "u", load);
    expect(load).toHaveBeenCalledTimes(1);
    time = PREVIEW_MISS_MS + 1;
    await cache.get("c", "u", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("revokes everything on clear", async () => {
    const revoke = vi.fn();
    const cache = createPreviewCache(() => 0, revoke);
    await cache.get("c", "u", async () => "blob:a");
    cache.clear();
    expect(revoke).toHaveBeenCalledWith("blob:a");
  });
});
