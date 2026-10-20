import { afterEach, describe, expect, it, vi } from "vitest";

import { canShowNotifications, tryShowNotification } from "./safeNotify";

describe("safeNotify", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when the constructor throws", () => {
    vi.stubGlobal(
      "Notification",
      class {
        constructor() {
          throw new TypeError("Illegal constructor");
        }
      },
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(tryShowNotification("t", {}, () => {})).toBe(false);
  });

  it("creates the notification and wires the click handler", () => {
    const addEventListener = vi.fn();
    const Ctor = vi.fn(function () {
      return { addEventListener };
    });
    vi.stubGlobal("Notification", Ctor);
    const onClick = () => {};
    expect(tryShowNotification("title", { body: "b" }, onClick)).toBe(true);
    expect(Ctor).toHaveBeenCalledWith("title", { body: "b" });
    expect(addEventListener).toHaveBeenCalledWith("click", onClick);
  });

  it("does not throw without a Notification global", () => {
    expect(canShowNotifications({})).toBe(false);
    expect(() => tryShowNotification("t", {}, () => {})).not.toThrow();
    expect(tryShowNotification("t", {}, () => {})).toBe(false);
  });

  it("needs granted permission", () => {
    expect(
      canShowNotifications({ Notification: { permission: "denied" } }),
    ).toBe(false);
    expect(
      canShowNotifications({ Notification: { permission: "granted" } }),
    ).toBe(true);
  });
});
