// Signs the installers of a published desktop release and uploads the .sig
// files. Needs the GitHub CLI (`gh`) logged in with write access.
//
//   node scripts/sign-release.mjs <version> --key <private-key.pem>
//
// It downloads the installers of release desktop-v<version> into a fresh temp
// directory, prints their SHA-512 so you can compare them with what CI built,
// asks for confirmation, signs them and uploads the .sig files to the release.
// The private key never leaves your machine. Several releasers can run this
// one after the other: each upload adds that releaser's line to the .sig.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { sha512OfFile } from "../src/main/updateSignature.ts";

const REPO = "I-develop-bugs-for-a-living/AnyTalk";
const args = process.argv.slice(2);
const keyFlag = args.indexOf("--key");
const keyPath = keyFlag >= 0 ? args[keyFlag + 1] : undefined;
const version = args.find((_, i) => i !== keyFlag && i !== keyFlag + 1);
if (!version || !keyPath) {
  console.error(
    "Usage: node scripts/sign-release.mjs <version> --key <private-key.pem>",
  );
  process.exit(1);
}
const tag = `desktop-v${version}`;

/** Run a command, inheriting output, and stop the script if it fails. */
function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const dir = mkdtempSync(join(tmpdir(), "anytalk-release-"));
// Existing .sig files are fetched too so another releaser's line is kept
for (const pattern of ["*.exe", "*.AppImage", "*.sig", "latest*.yml"]) {
  spawnSync(
    "gh",
    [
      "release",
      "download",
      tag,
      "--repo",
      REPO,
      "--dir",
      dir,
      "--pattern",
      pattern,
    ],
    { stdio: "inherit" },
  );
}
const installers = readdirSync(dir).filter((f) => /\.(exe|AppImage)$/.test(f));
if (installers.length === 0) {
  console.error(`No installers found on release ${tag}.`);
  process.exit(1);
}

/**
 * Read the `files:` entries of an electron-builder latest*.yml.
 * No yaml dependency: entries look like "  - url: <name>" followed by
 * indented "    sha512: <base64>" lines (the top-level sha512 is not indented).
 *
 * @param text The yml text
 * @returns Map of file name to base64 sha512
 */
function parseFileEntries(text) {
  const entries = new Map();
  let current;
  for (const line of text.split(/\r?\n/)) {
    const url = /^\s*-\s*url:\s*(.+?)\s*$/.exec(line);
    if (url) {
      current = url[1].replace(/^['"]|['"]$/g, "");
      continue;
    }
    const sha = /^\s+sha512:\s*(.+?)\s*$/.exec(line);
    if (sha && current) {
      entries.set(current, sha[1].replace(/^['"]|['"]$/g, ""));
      current = undefined;
    }
  }
  return entries;
}

// electron-builder writes sha512 as base64 in latest*.yml. Compare each
// downloaded installer with its own entry and stop if one differs or is missing.
const listedHashes = new Map();
for (const f of readdirSync(dir).filter((f) => /^latest.*\.yml$/.test(f)))
  for (const [name, hash] of parseFileEntries(
    readFileSync(join(dir, f), "utf8"),
  ))
    listedHashes.set(name, hash);
console.log(`\nDownloaded to ${dir}:`);
for (const file of installers) {
  const hex = await sha512OfFile(join(dir, file));
  const base64 = Buffer.from(hex, "hex").toString("base64");
  const listed = listedHashes.get(file) === base64;
  console.log(
    `  ${listed ? "OK      " : "MISMATCH"} ${hex.slice(0, 32)}...  ${file}`,
  );
  if (!listed) {
    console.error(
      `\n${file} does not match its entry in latest*.yml of the release. Aborting.`,
    );
    process.exit(1);
  }
}
console.log(
  "\nAll installers match latest*.yml (still compare with your own build if you can).",
);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Sign and upload these files? [y/N] ");
rl.close();
if (answer.trim().toLowerCase() !== "y") process.exit(1);

const files = installers.map((f) => join(dir, f));
run("node", [
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  fileURLToPath(new URL("./sign-update.mjs", import.meta.url)),
  "--version",
  version,
  "--key",
  keyPath,
  ...files,
]);
const sigs = readdirSync(dir).filter((f) => f.endsWith(".sig"));
run("gh", [
  "release",
  "upload",
  tag,
  "--repo",
  REPO,
  "--clobber",
  ...sigs.map((f) => join(dir, f)),
]);
console.log(`\nUploaded ${sigs.length} signature file(s) to ${tag}.`);
