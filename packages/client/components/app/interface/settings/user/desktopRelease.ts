/** Release tag prefix used by the desktop app workflow */
export const DESKTOP_TAG_PREFIX = "desktop-v";

/** Part of a GitHub release asset we use */
export interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

/** Part of a GitHub release we use */
export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: GithubAsset[];
  /** Release title */
  name?: string | null;
  /** Patch notes as markdown */
  body?: string | null;
  /** ISO date the release was published */
  published_at?: string | null;
}

/** Operating systems the desktop app is built for */
export type DesktopOs = "windows" | "linux";

/** Installer formats the desktop app is published in */
export type DesktopFormat = "exe" | "appimage" | "deb" | "rpm" | "pacman";

/** Normalised CPU architecture of a download */
export type DesktopArch = "x64" | "arm64" | "armv7l" | "unknown";

/** One installer a visitor can download */
export interface DesktopDownload {
  os: DesktopOs;
  format: DesktopFormat;
  arch: DesktopArch;
  /** File name on GitHub */
  name: string;
  url: string;
  /** Size in bytes */
  size: number;
}

/** What kind of device the visitor is on */
export type VisitorPlatform =
  | "windows"
  | "linux"
  | "macos"
  | "mobile"
  | "unknown";

/**
 * Pick the newest published desktop release from a GitHub releases list
 * @param releases Releases as returned by the API (newest first)
 * @returns The release, or undefined when there is none yet
 */
export function pickDesktopRelease(
  releases: GithubRelease[],
): GithubRelease | undefined {
  // the API lists newest first, so the first match is the newest
  return releases.find(
    (r) =>
      !r.draft &&
      !r.prerelease &&
      typeof r.tag_name === "string" &&
      r.tag_name.startsWith(DESKTOP_TAG_PREFIX),
  );
}

/**
 * Version number of a desktop release
 * @param release Release to read
 * @returns Version without the tag prefix, e.g. "1.2.0"
 */
export function releaseVersion(release: GithubRelease): string {
  return release.tag_name.slice(DESKTOP_TAG_PREFIX.length);
}

/** A version split into its parts */
interface ParsedVersion {
  core: [number, number, number];
  /** Pre-release identifiers, empty for a normal release */
  pre: string[];
}

/**
 * Split a semver string like "1.2.0" or "v1.2.0-beta.1" into its parts
 * @param value Version text
 * @returns The parts, or undefined when it isn't a version
 */
export function parseVersion(value: unknown): ParsedVersion | undefined {
  if (typeof value !== "string") return undefined;
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value.trim(),
    );
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

/**
 * Compare two versions by semver rules (a pre-release is older than its release)
 * @param a First version text
 * @param b Second version text
 * @returns Negative when a is older, positive when newer, 0 when equal, undefined when either isn't a version
 */
export function compareVersions(a: string, b: string): number | undefined {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return undefined;

  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }

  // no pre-release means a release, which is newer than any pre-release
  if (!pa.pre.length || !pb.pre.length) {
    return Number(!pa.pre.length) - Number(!pb.pre.length);
  }

  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    // the shorter list is older when everything before is equal
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    // numbers are older than words, numbers compare as numbers
    if (xNum && yNum) return Number(x) < Number(y) ? -1 : 1;
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether a version is newer than another
 * @returns False when either isn't a valid version
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  return (compareVersions(candidate, installed) ?? 0) > 0;
}

/**
 * All published desktop releases with a valid version, newest version first
 * @param releases Releases as returned by the API
 */
export function publishedDesktopReleases(
  releases: GithubRelease[],
): GithubRelease[] {
  return (Array.isArray(releases) ? releases : [])
    .filter(
      (r) =>
        r &&
        !r.draft &&
        !r.prerelease &&
        typeof r.tag_name === "string" &&
        r.tag_name.startsWith(DESKTOP_TAG_PREFIX) &&
        !!parseVersion(releaseVersion(r)),
    )
    .sort((a, b) => compareVersions(releaseVersion(b), releaseVersion(a)) ?? 0);
}

/**
 * Releases to show as patch notes: those newer than the installed version
 * (newest first, capped), or the installed version's own release if none is newer
 * @param releases Releases as returned by the API
 * @param installed Installed desktop version
 * @param cap Most releases to return
 */
export function releaseNotesFor(
  releases: GithubRelease[],
  installed: string,
  cap = 10,
): GithubRelease[] {
  const published = publishedDesktopReleases(releases);
  const newer = published.filter((r) =>
    isNewerVersion(releaseVersion(r), installed),
  );
  if (newer.length) return newer.slice(0, cap);
  return published.filter(
    (r) => compareVersions(releaseVersion(r), installed) === 0,
  );
}

/**
 * Turn an architecture word from a file name into a known one
 * @param value Word like "x86_64", "amd64" or "aarch64"
 */
function normaliseArch(value: string | undefined): DesktopArch {
  switch (value) {
    case "x64":
    case "x86_64":
    case "amd64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    case "armv7l":
    case "armhf":
      return "armv7l";
    default:
      return "unknown";
  }
}

/**
 * Work out what a release file is, if it is an installer
 * @param asset Release file
 * @returns The download, or undefined for blockmaps, update manifests and others
 */
export function classifyAsset(asset: GithubAsset): DesktopDownload | undefined {
  const base = {
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
  };

  // Windows: AnyTalk-Setup-<version>.exe
  if (/^AnyTalk-Setup-.+\.exe$/i.test(asset.name)) {
    return { ...base, os: "windows", format: "exe", arch: "x64" };
  }

  // Linux: AnyTalk-<version>-<arch>.<ext>
  const match = /^AnyTalk-.+-([A-Za-z0-9_]+)\.(AppImage|deb|rpm|pacman)$/.exec(
    asset.name,
  );
  if (match) {
    return {
      ...base,
      os: "linux",
      format: match[2].toLowerCase() as DesktopFormat,
      arch: normaliseArch(match[1]),
    };
  }
}

/** Display order of formats in the list */
const FORMAT_ORDER: DesktopFormat[] = [
  "exe",
  "appimage",
  "deb",
  "rpm",
  "pacman",
];

/**
 * All installers of a release, in display order (x64 before other CPUs)
 * @param release Release to read
 */
export function releaseDownloads(release: GithubRelease): DesktopDownload[] {
  return (release.assets ?? [])
    .map(classifyAsset)
    .filter((d): d is DesktopDownload => !!d)
    .sort(
      (a, b) =>
        FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format) ||
        Number(b.arch === "x64") - Number(a.arch === "x64"),
    );
}

/**
 * The installer to highlight for a visitor
 * @param downloads Downloads from `releaseDownloads`
 * @param platform The visitor's platform
 * @returns Windows installer or the Linux AppImage (x64 preferred), else undefined
 */
export function pickPrimaryDownload(
  downloads: DesktopDownload[],
  platform: VisitorPlatform,
): DesktopDownload | undefined {
  if (platform === "windows") return downloads.find((d) => d.os === "windows");
  if (platform === "linux") {
    // downloads are sorted with x64 first within each format
    return (
      downloads.find((d) => d.format === "appimage") ??
      downloads.find((d) => d.os === "linux")
    );
  }
}

/** Browser details used to detect the platform */
export interface PlatformInfo {
  userAgent?: string;
  /** `navigator.userAgentData.platform` when the browser has it */
  uaDataPlatform?: string;
  maxTouchPoints?: number;
}

/**
 * Detect what the visitor is using
 * @param info Browser details
 * @returns Platform; phones and tablets (including iPadOS) count as mobile
 */
export function detectPlatform(info: PlatformInfo): VisitorPlatform {
  const ua = info.userAgent ?? "";
  const hint = info.uaDataPlatform ?? "";

  // iPadOS reports itself as a Mac, but has a touch screen
  const isIpadOs = /Macintosh/i.test(ua) && (info.maxTouchPoints ?? 0) > 1;
  if (/Android|iPhone|iPad|iPod/i.test(`${hint} ${ua}`) || isIpadOs) {
    return "mobile";
  }

  if (hint) {
    if (/^windows$/i.test(hint)) return "windows";
    if (/^macos$/i.test(hint)) return "macos";
    if (/^linux$/i.test(hint)) return "linux";
    if (/chrome\s?os/i.test(hint)) return "unknown";
  }

  if (/CrOS/i.test(ua)) return "unknown";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "unknown";
}

/**
 * Format a file size for display
 * @param bytes Size in bytes
 * @returns Text like "85.2 MB"
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
