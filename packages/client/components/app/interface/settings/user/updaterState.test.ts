import { afterEach, describe, expect, it, vi } from "vitest";

import {
  desktopActionFor,
  desktopNoticeKey,
  installStarted,
  pickUpdateNotice,
  runUpdate,
  updateBusy,
  updateFailed,
  withVersion,
} from "./updaterState";

/** Build an updater state for the tests */
const st = (
  status: UpdaterStatus,
  extra: Partial<UpdaterState> = {},
): UpdaterState => ({ status, ...extra });

describe("desktopActionFor", () => {
  it("maps the states that need the user", () => {
    expect(desktopActionFor(st("downloaded", { version: "1" }))).toBe(
      "restart",
    );
    expect(desktopActionFor(st("available", { version: "1" }))).toBe(
      "download",
    );
    expect(desktopActionFor(st("downloading", { percent: 5 }))).toBe(
      "downloading",
    );
    expect(desktopActionFor(st("error", { version: "1" }))).toBe("retry");
  });

  it("offers nothing otherwise", () => {
    for (const status of [
      "idle",
      "checking",
      "up-to-date",
      "unsupported",
    ] as const) {
      expect(desktopActionFor(st(status))).toBeUndefined();
    }
    expect(desktopActionFor(st("error"))).toBeUndefined();
    expect(desktopActionFor(undefined)).toBeUndefined();
  });
});

describe("pickUpdateNotice", () => {
  it("shows nothing without updates", () => {
    expect(pickUpdateNotice(undefined, undefined, false)).toBeUndefined();
  });

  it("shows the web card for a web update only", () => {
    expect(pickUpdateNotice(st("up-to-date"), undefined, true)).toEqual({
      type: "web",
    });
  });

  it("shows the desktop card for a desktop update only", () => {
    expect(
      pickUpdateNotice(st("downloaded", { version: "2" }), undefined, false),
    ).toEqual({ type: "desktop", action: "restart" });
  });

  it("prefers the desktop card when both exist", () => {
    expect(
      pickUpdateNotice(st("available", { version: "2" }), undefined, true),
    ).toEqual({ type: "desktop", action: "download" });
  });

  it("does not show the web card after dismissing the desktop card", () => {
    expect(
      pickUpdateNotice(st("downloaded", { version: "2" }), "2:ready", true),
    ).toBeUndefined();
  });

  it("shows the desktop card again for a newer version", () => {
    expect(
      pickUpdateNotice(st("downloaded", { version: "3" }), "2:ready", false),
    ).toEqual({ type: "desktop", action: "restart" });
  });
});

describe("installStarted", () => {
  it("treats an old shell without answer as started", () => {
    expect(installStarted(undefined)).toBe(true);
    expect(installStarted(true)).toBe(true);
  });

  it("detects a refused install", () => {
    expect(installStarted(false)).toBe(false);
  });
});

describe("dismissing", () => {
  const dismissed = desktopNoticeKey(st("available", { version: "2" }));

  it("stays hidden while the update downloads", () => {
    expect(
      pickUpdateNotice(st("downloading", { version: "2" }), dismissed, false),
    ).toBeUndefined();
  });

  it("shows the restart card for the same version", () => {
    expect(
      pickUpdateNotice(st("downloaded", { version: "2" }), dismissed, false),
    ).toEqual({ type: "desktop", action: "restart" });
  });
});

describe("withVersion", () => {
  it("fills a missing version while downloading", () => {
    expect(withVersion(st("downloading", { percent: 3 }), "2").version).toBe(
      "2",
    );
  });

  it("leaves other states alone", () => {
    expect(withVersion(st("up-to-date"), "2").version).toBeUndefined();
  });
});

describe("runUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stub the window with a desktop updater */
  const stub = (updater: object) => {
    vi.stubGlobal("window", { desktopUpdater: updater });
    vi.spyOn(console, "error").mockImplementation(() => {});
  };

  it("resets and reports a refused install", async () => {
    stub({ install: vi.fn().mockResolvedValue(false) });
    await runUpdate({ type: "desktop", action: "restart" }, () => {});
    expect(updateBusy()).toBe(false);
    expect(updateFailed()).toBe(true);
  });

  it("reports a failed download", async () => {
    stub({ download: vi.fn().mockRejectedValue(new Error("x")) });
    await runUpdate({ type: "desktop", action: "download" }, () => {});
    expect(updateBusy()).toBe(false);
    expect(updateFailed()).toBe(true);
  });
});
