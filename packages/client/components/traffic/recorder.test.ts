import { describe, expect, it, vi } from "vitest";

import { TrafficRecorder } from "./recorder";

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
