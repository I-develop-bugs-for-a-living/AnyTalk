// Bundles the main and preload code into dist/ and copies static assets.
// The server URL baked into the build comes from ANYTALK_DEFAULT_URL.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

// Built-in fallback when ANYTALK_DEFAULT_URL is not set
const FALLBACK_URL = "https://chat.any-portal.tech";
const defaultUrl =
  (process.env.ANYTALK_DEFAULT_URL ?? "").trim() || FALLBACK_URL;
try {
  const parsed = new URL(defaultUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
} catch {
  console.error(
    `[desktop] ANYTALK_DEFAULT_URL is not a valid http(s) URL: ${defaultUrl}`,
  );
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [resolve(root, "src/main/index.ts")],
  outfile: resolve(dist, "main.js"),
  define: { __DEFAULT_URL__: JSON.stringify(defaultUrl) },
});

await build({
  ...common,
  entryPoints: [resolve(root, "src/preload/index.ts")],
  outfile: resolve(dist, "preload.js"),
});

cpSync(resolve(root, "src/error-page"), resolve(dist, "error-page"), {
  recursive: true,
});
cpSync(resolve(root, "build/icon.png"), resolve(dist, "icon.png"));
cpSync(resolve(root, "build/icon.ico"), resolve(dist, "icon.ico"));
console.log(`[desktop] built, default server URL: ${defaultUrl}`);
