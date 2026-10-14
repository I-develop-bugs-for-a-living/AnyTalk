#!/usr/bin/env node
/**
 * Drift check for ARCHITECTURE.md (the local project map).
 *
 * Runs at session start through a SessionStart hook. Prints nothing and exits 0
 * when the map looks current. When it finds drift it prints one short message
 * naming what's missing or stale and asking the session to run `map-keeper`.
 * Always exits 0 so it can never block a session.
 *
 * Usage: node check-architecture.mjs [--map <path>] [--threshold <n>]
 *   --map        map file to check (default: <repo>/ARCHITECTURE.md), used for tests
 *   --threshold  changed-file count that counts as drift (default: 30)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, two levels above this script (.claude/scripts). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The client package; most paths in the map are relative to it. */
const CLIENT = join(ROOT, "packages/client");

/** Generated translation catalogs, never counted. */
const CATALOGS = "packages/client/components/i18n/catalogs";

/** Folders whose sub-folders count as feature areas, and how the map refers to them. */
const AREA_ROOTS = [
  { dir: "components", label: (d) => `components/${d}`, patterns: (d) => [`components/${d}`, `@revolt/${d}`] },
  { dir: "components/app/interface", label: (d) => `app/interface/${d}`, patterns: (d) => [`app/interface/${d}`, `\`interface/${d}`] },
  { dir: "src/interface", label: (d) => `src/interface/${d}`, patterns: (d) => [`src/interface/${d}`] },
];

/** Folders that are never feature areas. */
const IGNORED_DIRS = new Set(["node_modules", "dist", "catalogs"]);

/** Path prefixes in the map that are checked for existence. */
const PATH_PREFIXES = ["components/", "src/", "packages/", "doc/", "patches/", "docker/", ".github/", "scripts/"];

/** Folders a relative map path may be relative to. */
const PATH_BASES = [CLIENT, ROOT, join(ROOT, "packages/desktop"), join(ROOT, "doc/src")];

/**
 * Commits this soon after the map's last update are ignored: they are usually
 * the work the map update already describes, committed right after it.
 */
const GRACE_MS = 60 * 60 * 1000;

/**
 * Reads a command line option.
 * @param {string} name option name without dashes
 * @returns {string | undefined}
 */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/**
 * Lists the direct sub-folders of a folder inside the client package.
 * @param {string} rel folder relative to packages/client
 * @returns {string[]}
 */
function subdirs(rel) {
  const abs = join(CLIENT, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !IGNORED_DIRS.has(e.name))
    .map((e) => e.name);
}

/**
 * Checks whether the map mentions a name as a whole path segment
 * (`components/rtc` doesn't count as a mention of `components/r`).
 * @param {string} map map contents
 * @param {string} name name or path to look for
 * @returns {boolean}
 */
function mentions(map, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?![\\w-])`).test(map);
}

/**
 * Finds feature areas and stores that exist on disk but aren't in the map.
 * @param {string} map map contents
 * @returns {string[]}
 */
function findMissing(map) {
  const missing = [];
  for (const root of AREA_ROOTS) {
    for (const d of subdirs(root.dir)) {
      if (!root.patterns(d).some((p) => mentions(map, p))) missing.push(root.label(d));
    }
  }
  for (const store of storeNames()) {
    if (!map.includes(`\`${store}\``)) missing.push(`store ${store}`);
  }
  return missing;
}

/**
 * Lists the store names in components/state/stores (files, without tests and index).
 * @returns {string[]}
 */
function storeNames() {
  const abs = join(CLIENT, "components/state/stores");
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => /^[A-Z]\w*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => f.replace(/\.tsx?$/, ""));
}

/**
 * Finds paths, aliases and stores the map mentions that no longer exist.
 * @param {string} map map contents
 * @returns {string[]}
 */
function findStale(map) {
  const stale = new Set();

  // Backticked paths with a known prefix, checked against the possible bases.
  for (const [, raw] of map.matchAll(/`([^`\s]+)`/g)) {
    if (!PATH_PREFIXES.some((p) => raw.startsWith(p))) continue;
    if (/[*:{}<>]|\.\.\./.test(raw)) continue;
    const path = raw.replace(/\/$/, "");
    if (!PATH_BASES.some((base) => existsSync(join(base, path)))) stale.add(path);
  }

  // @revolt/* aliases need a matching components folder.
  for (const [, name] of map.matchAll(/@revolt\/([\w-]+)/g)) {
    if (!existsSync(join(CLIENT, "components", name))) stale.add(`@revolt/${name}`);
  }

  // Store names listed in the State stores table need a store file.
  const section = map.split(/^## State stores/m)[1]?.split(/^## /m)[0] ?? "";
  const stores = new Set(storeNames());
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cell = line.split("|")[1];
    for (const [, name] of cell.matchAll(/`(\w+)`/g)) {
      if (!stores.has(name)) stale.add(`store ${name}`);
    }
  }

  return [...stale];
}

/**
 * Counts source files changed in commits made after the map was last modified
 * (plus the grace period). Catalogs and the lockfile are left out.
 * @param {string} mapPath map file
 * @returns {number}
 */
function changedSinceMap(mapPath) {
  const since = new Date(statSync(mapPath).mtimeMs + GRACE_MS).toISOString();
  const out = execFileSync(
    "git",
    ["log", `--since=${since}`, "--name-only", "--format=", "--", ".", `:!${CATALOGS}`, ":!pnpm-lock.yaml"],
    { cwd: ROOT, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] },
  );
  return new Set(out.split("\n").filter(Boolean)).size;
}

/**
 * Runs all checks and prints a message when the map has drifted.
 */
function main() {
  const mapPath = resolve(arg("map") ?? join(ROOT, "ARCHITECTURE.md"));
  const threshold = Number(arg("threshold") ?? 30);
  if (!existsSync(mapPath)) {
    console.log("ARCHITECTURE.md is missing. Run the map-keeper agent to recreate it.");
    return;
  }

  const map = readFileSync(mapPath, "utf8");
  const problems = [];

  const missing = findMissing(map);
  if (missing.length) problems.push(`not in the map: ${missing.join(", ")}`);

  const stale = findStale(map);
  if (stale.length) problems.push(`no longer exist: ${stale.join(", ")}`);

  let changed = 0;
  try {
    changed = changedSinceMap(mapPath);
  } catch {
    // No git or not a repo: skip this check.
  }
  if (changed > threshold) problems.push(`${changed} files changed in commits since the map's last update`);

  if (problems.length) {
    console.log(
      `ARCHITECTURE.md drift: ${problems.join("; ")}. Run the map-keeper agent in the background with this report and tell the user in one line.`,
    );
  }
}

try {
  main();
} catch {
  // Never block or fail a session.
}
process.exit(0);
