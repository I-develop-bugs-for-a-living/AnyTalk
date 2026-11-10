import { describe, expect, it } from "vitest";

import { pickPipTrack } from "./pipTrack";

const screen = (id: string) => ({ source: "screen_share", id });
const camera = (id: string, muted = false) => ({
  source: "camera",
  id,
  publication: { isMuted: muted },
});
const never = () => false;

describe("pickPipTrack", () => {
  it("shows nothing without streams", () => {
    expect(pickPipTrack(undefined, [], undefined, never)).toBeUndefined();
  });

  it("prefers the focused stream", () => {
    const a = screen("a");
    const b = screen("b");
    expect(pickPipTrack(b, [a, b], undefined, never)).toBe(b);
  });

  it("prefers a focused camera with video", () => {
    const cam = camera("c");
    expect(pickPipTrack(cam, [screen("a")], undefined, never)).toBe(cam);
  });

  it("falls back to the first watched stream for a muted camera", () => {
    const a = screen("a");
    expect(pickPipTrack(camera("c", true), [a], undefined, never)).toBe(a);
  });

  it("falls back for a camera placeholder", () => {
    const a = screen("a");
    expect(
      pickPipTrack({ source: "camera", id: "c" }, [a], undefined, never),
    ).toBe(a);
  });

  it("skips popped out streams", () => {
    const a = screen("a");
    const b = screen("b");
    expect(pickPipTrack(a, [a, b], undefined, (t) => t === a)).toBe(b);
  });

  it("shows nothing when every stream is popped out", () => {
    const a = screen("a");
    expect(pickPipTrack(a, [a], undefined, () => true)).toBeUndefined();
  });

  it("falls back to our own screen share", () => {
    const mine = screen("mine");
    expect(pickPipTrack(undefined, [], mine, never)).toBe(mine);
  });

  it("prefers a watched stream over our own share", () => {
    const a = screen("a");
    expect(pickPipTrack(undefined, [a], screen("mine"), never)).toBe(a);
  });

  it("shows our own share when it is focused", () => {
    const mine = screen("mine");
    expect(pickPipTrack(mine, [screen("a")], mine, never)).toBe(mine);
  });

  it("skips our own share when it is popped out", () => {
    const mine = screen("mine");
    expect(
      pickPipTrack(undefined, [], mine, (t) => t === mine),
    ).toBeUndefined();
  });
});
