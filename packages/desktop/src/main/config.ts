import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { DesktopConfig } from "../shared/ipc";

/** Defaults used for every key missing from the stored file. */
const DEFAULTS: DesktopConfig = {
  firstLaunch: true,
  customFrame: true,
  minimiseToTray: true,
  startMinimisedToTray: false,
  spellchecker: true,
  hardwareAcceleration: true,
  discordRpc: false,
  autoUpdate: true,
  serverUrl: "",
  windowState: { isMaximised: false, width: 1280, height: 800 },
};

/** Path of the JSON config file in the user data directory. */
const configPath = () => join(app.getPath("userData"), "config.json");

let current: DesktopConfig | undefined;

/**
 * Merge stored values over the defaults, ignoring keys of the wrong type.
 *
 * @param stored Parsed JSON, or anything else if the file was damaged
 * @returns A complete config
 */
function normalise(stored: unknown): DesktopConfig {
  const result: DesktopConfig = {
    ...DEFAULTS,
    windowState: { ...DEFAULTS.windowState },
  };
  if (typeof stored !== "object" || stored === null) return result;
  const source = stored as Record<string, unknown>;

  for (const key of Object.keys(DEFAULTS) as (keyof DesktopConfig)[]) {
    if (key === "windowState") continue;
    if (typeof source[key] === typeof DEFAULTS[key]) {
      (result as Record<string, unknown>)[key] = source[key];
    }
  }

  const ws = source.windowState;
  if (typeof ws === "object" && ws !== null) {
    const state = ws as Record<string, unknown>;
    if (typeof state.isMaximised === "boolean")
      result.windowState.isMaximised = state.isMaximised;
    for (const key of ["width", "height", "x", "y"] as const) {
      if (typeof state[key] === "number" && Number.isFinite(state[key]))
        result.windowState[key] = state[key] as number;
    }
  }
  return result;
}

/**
 * Get the config, loading it from disk on first use.
 *
 * @returns The live config object
 */
export function getConfig(): DesktopConfig {
  if (!current) {
    try {
      current = normalise(JSON.parse(readFileSync(configPath(), "utf8")));
    } catch {
      current = normalise(undefined);
    }
  }
  return current;
}

/**
 * Merge a partial update into the config and write it to disk.
 *
 * @param partial Keys to change, `windowState` is merged one level deep
 * @returns The new config
 */
export function updateConfig(partial: Partial<DesktopConfig>): DesktopConfig {
  const next = normalise({
    ...getConfig(),
    ...partial,
    windowState: { ...getConfig().windowState, ...partial.windowState },
  });
  current = next;
  try {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    // Write to a temp file first so a crash can't leave half a config
    writeFileSync(path + ".tmp", JSON.stringify(next, null, 2));
    renameSync(path + ".tmp", path);
  } catch (error) {
    console.error("Failed to save config", error);
  }
  return next;
}
