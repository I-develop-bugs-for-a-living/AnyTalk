import { describe, expect, it, vi } from "vitest";

import { TrafficRecorder } from "./recorder";
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
