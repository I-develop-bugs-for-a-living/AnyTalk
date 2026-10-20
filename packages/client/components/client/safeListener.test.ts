import { describe, expect, it, vi } from "vitest";

import { neverThrows } from "./safeListener";

describe("neverThrows", () => {
  it("swallows errors thrown by a listener and logs them", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = neverThrows("test", () => {
      throw new Error("boom");
    });
    expect(() => wrapped()).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("passes arguments through", () => {
    const listener = vi.fn();
    neverThrows("test", listener)(1, 2);
    expect(listener).toHaveBeenCalledWith(1, 2);
  });
});
