import { describe, expect, it } from "vitest";

import { ButtonCapture } from "./capture";

describe("ButtonCapture", () => {
  it("ignores buttons held at the start until they are released", () => {
    const capture = new ButtonCapture(1000);
    expect(capture.poll(["a"], 0)).toEqual({ kind: "waiting" });
    expect(capture.poll(["a"], 10)).toEqual({ kind: "waiting" });
    expect(capture.poll([], 20)).toEqual({ kind: "waiting" });
    expect(capture.poll(["l3"], 30)).toEqual({
      kind: "captured",
      button: "l3",
    });
  });

  it("times out", () => {
    const capture = new ButtonCapture(1000);
    capture.poll([], 0);
    expect(capture.poll([], 1000)).toEqual({ kind: "timeout" });
  });
});
