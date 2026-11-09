import { describe, expect, it, vi } from "vitest";

import { TrafficRecorder, estimateEntryBytes } from "./recorder";
import type { NewEntry } from "./types";

describe("TrafficRecorder", () => {
  it("starts off and assigns ids", () => {
    const r = new TrafficRecorder();
    expect(r.enabled).toBe(false);
    r.record({
      kind: "resource",
      url: "u",
      host: "h",
      initiatorType: "img",
      start: 0,
      durationMs: 1,
      transferSize: 0,
      encodedBodySize: 0,
      decodedBodySize: 0,
      protocol: "h2",
    });
    expect(r.snapshot().map((e) => e.id)).toEqual([1]);
  });

  it("caps entries and notifies", () => {
    const r = new TrafficRecorder(2);
    const listener = vi.fn();
    r.subscribe(listener);
    for (let i = 0; i < 3; i++) {
      r.record({
        kind: "ws",
        connectionId: 1,
        event: "open",
        url: "u",
        host: "h",
        time: i,
      });
    }
    expect(r.snapshot().map((e) => e.id)).toEqual([2, 3]);
    expect(listener).toHaveBeenCalledTimes(3);
    r.clear();
    expect(r.snapshot()).toEqual([]);
  });
});

describe("desktop file budget", () => {
  it("keeps desktop files from pushing other entries out", async () => {
    const { DESKTOP_FILE_CAPACITY, TrafficRecorder } =
      await import("./recorder");
    const recorder = new TrafficRecorder(3);
    const file = (n: number): NewEntry => ({
      kind: "http",
      source: "desktop",
      resourceType: "image",
      method: "GET",
      url: `https://a.test/${n}.png`,
      host: "a.test",
      start: n,
      end: n,
      requestHeaders: [],
      responseHeaders: [],
      requestBody: { kind: "none" },
    });
    recorder.record({
      kind: "ws",
      connectionId: 1,
      event: "open",
      url: "wss://a.test/",
      host: "a.test",
      time: 1,
    });
    for (let n = 0; n < DESKTOP_FILE_CAPACITY + 50; n++)
      recorder.record(file(n));
    const all = recorder.snapshot();
    expect(all.filter((e) => e.kind === "ws")).toHaveLength(1);
    expect(all).toHaveLength(DESKTOP_FILE_CAPACITY + 1);
    // still in id order
    expect(all.map((e) => e.id)).toEqual(
      [...all.map((e) => e.id)].sort((a, b) => a - b),
    );
  });
});

describe("memory budget", () => {
  const frame = (n: number, size: number): NewEntry => ({
    kind: "ws",
    connectionId: 1,
    event: "frame",
    url: "wss://a.test/",
    host: "a.test",
    time: n,
    text: "x".repeat(size),
  });

  it("estimates bigger entries as bigger", () => {
    const small = { ...frame(1, 10), id: 1 };
    const big = { ...frame(1, 10_000), id: 2 };
    expect(estimateEntryBytes(big)).toBeGreaterThan(
      estimateEntryBytes(small) + 19_000,
    );
  });

  it("drops the oldest entries over the byte budget and counts them", () => {
    const r = new TrafficRecorder(1000, 50_000);
    expect(r.dropped).toBe(0);
    for (let n = 1; n <= 10; n++) r.record(frame(n, 10_000));
    const kept = r.snapshot();
    expect(kept.length).toBeLessThan(10);
    expect(kept.length).toBeGreaterThan(0);
    // the newest survive
    expect(kept[kept.length - 1].id).toBe(10);
    expect(r.dropped).toBe(10 - kept.length);
  });

  it("counts entries dropped by the count cap and resets on clear", () => {
    const r = new TrafficRecorder(2);
    for (let n = 1; n <= 5; n++) r.record(frame(n, 1));
    expect(r.dropped).toBe(3);
    r.clear();
    expect(r.dropped).toBe(0);
  });
});
