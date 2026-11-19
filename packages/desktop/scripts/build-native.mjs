// Builds the per-process audio add-on (native/app-audio, Rust + napi-rs) and
// copies it to native/app-audio/app-audio.node. Only needed for Windows
// builds: on any other host it does nothing, and the app runs without it.
// Pass --force to build on another host (e.g. to check the Rust code), and
// --target <triple> to choose the Rust target (default: the host's), and
// --if-stale to skip the build when app-audio.node is newer than every Rust
// source (the packaging scripts use it, so CI, which builds the add-on in its
// own step, doesn't build it twice while a local package:win still picks up
// Rust changes).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = resolve(root, "native/app-audio");
const args = process.argv.slice(2);
const force = args.includes("--force");
const targetIndex = args.indexOf("--target");
const ifStale = args.includes("--if-stale");
const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;

if (process.platform !== "win32" && !force) {
  console.log("[native] app-audio is Windows only, skipping");
  process.exit(0);
}

/**
 * Whether the built add-on is up to date with its sources.
 *
 * @returns True if `app-audio.node` exists and is newer than every Rust source
 */
function isUpToDate() {
  const output = resolve(crate, "app-audio.node");
  if (!existsSync(output)) return false;
  const built = statSync(output).mtimeMs;
  const sources = [
    resolve(crate, "Cargo.toml"),
    resolve(crate, "Cargo.lock"),
    resolve(crate, "build.rs"),
    ...readdirSync(resolve(crate, "src"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => resolve(entry.parentPath, entry.name)),
  ];
  return sources.every((file) => statSync(file).mtimeMs <= built);
}

if (ifStale && isUpToDate()) {
  console.log("[native] app-audio.node is up to date, skipping");
  process.exit(0);
}

const cargoArgs = ["build", "--release", "--locked"];
if (target) cargoArgs.push("--target", target);
const build = spawnSync("cargo", cargoArgs, {
  cwd: crate,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  console.error("[native] cargo build failed");
  process.exit(build.status ?? 1);
}

// The cdylib is named after the crate, with the platform's prefix and suffix
const outDir = resolve(crate, "target", ...(target ? [target] : []), "release");
const candidates = [
  "anytalk_app_audio.dll",
  "libanytalk_app_audio.so",
  "libanytalk_app_audio.dylib",
];
const built = candidates.map((n) => resolve(outDir, n)).find(existsSync);
if (!built) {
  console.error(`[native] no library found in ${outDir}`);
  process.exit(1);
}
copyFileSync(built, resolve(crate, "app-audio.node"));
console.log(`[native] built ${built} -> native/app-audio/app-audio.node`);
