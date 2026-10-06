import { describe, expect, it } from "vitest";

import {
  type GithubRelease,
  classifyAsset,
  compareVersions,
  detectPlatform,
  isNewerVersion,
  pickDesktopRelease,
  pickPrimaryDownload,
  releaseDownloads,
  releaseNotesFor,
  releaseVersion,
} from "./desktopRelease";

/** Build a release for tests */
const release = (tag: string, extra: Partial<GithubRelease> = {}) =>
  ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: "https://example.com",
    assets: [],
    ...extra,
  }) as GithubRelease;

/** Build an asset for tests */
const asset = (name: string) => ({
  name,
  size: 1000,
  browser_download_url: `https://example.com/${name}`,
});

describe("pickDesktopRelease", () => {
  it("skips other tags, drafts and prereleases", () => {
    const list = [
      release("v1.0.0"),
      release("desktop-v0.3.0", { draft: true }),
      release("desktop-v0.2.0", { prerelease: true }),
      release("desktop-v0.1.0"),
    ];
    expect(pickDesktopRelease(list)?.tag_name).toBe("desktop-v0.1.0");
  });

  it("returns undefined when there is none", () => {
    expect(pickDesktopRelease([release("v1")])).toBeUndefined();
    expect(pickDesktopRelease([])).toBeUndefined();
  });

  it("reads the version", () => {
    expect(releaseVersion(release("desktop-v1.2.3"))).toBe("1.2.3");
  });
});

describe("assets", () => {
  const r = release("desktop-v1.0.0", {
    assets: [
      asset("AnyTalk-1.0.0-arm64.AppImage"),
      asset("AnyTalk-1.0.0-x86_64.AppImage"),
      asset("AnyTalk-1.0.0-amd64.deb"),
      asset("AnyTalk-1.0.0-x86_64.rpm"),
      asset("AnyTalk-1.0.0-x64.pacman"),
      asset("AnyTalk-Setup-1.0.0.exe"),
      asset("AnyTalk-Setup-1.0.0.exe.blockmap"),
      asset("latest.yml"),
      asset("latest-linux.yml"),
    ],
  });

  it("ignores non-installers", () => {
    expect(classifyAsset(asset("latest.yml"))).toBeUndefined();
    expect(
      classifyAsset(asset("AnyTalk-Setup-1.0.0.exe.blockmap")),
    ).toBeUndefined();
    expect(releaseDownloads(r)).toHaveLength(6);
  });

  it("sorts Windows first and x64 before other archs", () => {
    const list = releaseDownloads(r);
    expect(list[0].format).toBe("exe");
    expect(list[1].arch).toBe("x64");
    expect(list[2].arch).toBe("arm64");
  });

  it("picks the primary download per platform", () => {
    const list = releaseDownloads(r);
    expect(pickPrimaryDownload(list, "windows")?.format).toBe("exe");
    const linux = pickPrimaryDownload(list, "linux");
    expect(linux?.format).toBe("appimage");
    expect(linux?.arch).toBe("x64");
    expect(pickPrimaryDownload(list, "macos")).toBeUndefined();
    expect(pickPrimaryDownload(list, "mobile")).toBeUndefined();
  });
});

describe("detectPlatform", () => {
  it("prefers userAgentData", () => {
    expect(detectPlatform({ uaDataPlatform: "Windows", userAgent: "" })).toBe(
      "windows",
    );
    expect(detectPlatform({ uaDataPlatform: "Linux", userAgent: "" })).toBe(
      "linux",
    );
    expect(detectPlatform({ uaDataPlatform: "macOS", userAgent: "" })).toBe(
      "macos",
    );
    expect(
      detectPlatform({ uaDataPlatform: "Android", userAgent: "Linux" }),
    ).toBe("mobile");
  });

  it("falls back to the user agent", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toBe("windows");
    expect(
      detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }),
    ).toBe("linux");
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 0,
      }),
    ).toBe("macos");
    expect(
      detectPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" }),
    ).toBe("mobile");
    expect(
      detectPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" }),
    ).toBe("mobile");
    expect(
      detectPlatform({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64)" }),
    ).toBe("unknown");
    expect(detectPlatform({})).toBe("unknown");
  });

  it("treats iPadOS as mobile", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 5,
      }),
    ).toBe("mobile");
  });
});

describe("compareVersions", () => {
  it("compares numbers, not text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });

  it("ranks pre-releases below their release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
  });

  it("returns undefined for garbage", () => {
    expect(compareVersions("abc", "1.0.0")).toBeUndefined();
    expect(compareVersions("1.0", "1.0.0")).toBeUndefined();
    expect(compareVersions("", "")).toBeUndefined();
    expect(isNewerVersion("abc", "1.0.0")).toBe(false);
  });
});

describe("releaseNotesFor", () => {
  const list = [
    release("desktop-v1.3.0"),
    release("desktop-v1.2.0"),
    release("desktop-v1.1.0-beta.1", { prerelease: true }),
    release("desktop-v1.1.0"),
    release("desktop-vgarbage"),
    release("v9.9.9"),
    release("desktop-v1.0.0", { draft: true }),
    release("desktop-v1.0.0"),
  ];

  it("lists newer releases, newest first", () => {
    expect(releaseNotesFor(list, "1.1.0").map(releaseVersion)).toEqual([
      "1.3.0",
      "1.2.0",
    ]);
  });

  it("caps the list", () => {
    expect(releaseNotesFor(list, "1.0.0", 2)).toHaveLength(2);
  });

  it("falls back to the installed release", () => {
    expect(releaseNotesFor(list, "1.3.0").map(releaseVersion)).toEqual([
      "1.3.0",
    ]);
  });

  it("copes with a missing list", () => {
    expect(releaseNotesFor(undefined as never, "1.0.0")).toEqual([]);
  });
});
