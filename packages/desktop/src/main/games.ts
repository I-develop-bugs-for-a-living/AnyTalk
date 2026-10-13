import { app, desktopCapturer } from "electron";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { type GameEntry, GAME_LIST } from "../shared/games";
import { type RunningGame, IPC } from "../shared/ipc";
import {
  type GameMatch,
  type ProcInfo,
  type WindowInfo,
  buildRunningGames,
  linuxNames,
  matchGames,
  parseTasklist,
  parseXpropPid,
  sameRunningGames,
  windowIdOf,
} from "./gameMatch";
import { isWayland } from "./platform";
import { isServerUrl } from "./url";

/** Poll interval while no known game runs. */
const IDLE_INTERVAL_MS = 5_000;
/** Poll interval while a game runs, kept slow to leave the CPU to the game. */
const ACTIVE_INTERVAL_MS = 3_000;
/** Least time between two PowerShell runs when only a window is missing. */
const POWERSHELL_RETRY_MS = 4_000;

/** The platforms detection works on, anything else does nothing. */
const platform: "win32" | "linux" | undefined =
  process.platform === "win32" || process.platform === "linux"
    ? process.platform
    : undefined;

/** Gives the window that receives updates. */
let getTarget: () => Electron.WebContents | undefined = () => undefined;
/** Whether detection is on. */
let enabled = false;
/** The timer of the next scan. */
let timer: ReturnType<typeof setTimeout> | undefined;
/** The scan that is running now, there is never more than one. */
let scanning: Promise<void> | undefined;
/** The list sent last. */
let latest: RunningGame[] = [];
/** Bundled and user games, loaded on first use. */
let entries: GameEntry[] | undefined;

/**
 * Check that a value from `games.json` has the shape of a game entry.
 *
 * @param value Parsed JSON
 * @returns Whether it can be used as an entry
 */
function isGameEntry(value: unknown): value is GameEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  const exes = entry.executables;
  const strings = (list: unknown) =>
    list === undefined ||
    (Array.isArray(list) &&
      list.length <= 50 &&
      list.every((item) => typeof item === "string" && item.length <= 260));
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    entry.id.length <= 100 &&
    typeof entry.name === "string" &&
    entry.name.length > 0 &&
    entry.name.length <= 100 &&
    typeof exes === "object" &&
    exes !== null &&
    !Array.isArray(exes) &&
    strings((exes as Record<string, unknown>).win32) &&
    strings((exes as Record<string, unknown>).linux) &&
    strings(entry.clients) &&
    (entry.gameNames === undefined ||
      (typeof entry.gameNames === "object" &&
        entry.gameNames !== null &&
        !Array.isArray(entry.gameNames) &&
        Object.entries(entry.gameNames).length <= 50 &&
        Object.entries(entry.gameNames).every(
          ([exe, name]) =>
            exe.length <= 260 &&
            typeof name === "string" &&
            name.length > 0 &&
            name.length <= 100,
        )))
  );
}

/**
 * Load the bundled list plus the user's `userData/games.json`. The user
 * file is read-only for now: a missing or broken file counts as empty, and
 * an entry with a bundled id replaces the bundled one.
 *
 * @returns All known games
 */
function loadEntries(): GameEntry[] {
  let user: GameEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(app.getPath("userData"), "games.json"), "utf8"),
    );
    if (Array.isArray(parsed)) {
      // Cap the count and keep the first entry of each id
      const seen = new Set<string>();
      user = parsed
        .slice(0, 500)
        .filter(isGameEntry)
        .filter((entry) => !seen.has(entry.id) && !!seen.add(entry.id));
    }
  } catch {
    // No file or unreadable JSON, use the bundled list only
  }
  const ids = new Set(user.map((entry) => entry.id));
  return [...GAME_LIST.filter((entry) => !ids.has(entry.id)), ...user];
}

/**
 * Run a program and collect its output.
 *
 * @param file Program
 * @param args Arguments
 * @param timeout Milliseconds before the program is killed
 * @returns stdout, or undefined if it failed
 */
function run(
  file: string,
  args: string[],
  timeout = 10_000,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

/**
 * List the running processes.
 *
 * @returns Pids with their names, empty on failure
 */
async function listProcesses(): Promise<ProcInfo[]> {
  if (platform === "win32") {
    return parseTasklist((await run("tasklist", ["/fo", "csv", "/nh"])) ?? "");
  }

  let dirs: string[];
  try {
    dirs = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const procs = await Promise.all(
    dirs.map(async (dir): Promise<ProcInfo | undefined> => {
      try {
        const [comm, cmdline] = await Promise.all([
          readFile(`/proc/${dir}/comm`, "utf8"),
          readFile(`/proc/${dir}/cmdline`, "utf8"),
        ]);
        return { pid: Number(dir), names: linuxNames(comm, cmdline) };
      } catch {
        // The process ended while we looked
        return undefined;
      }
    }),
  );
  return procs.filter((proc): proc is ProcInfo => !!proc);
}

/** Window handle to pid, kept between scans so PowerShell runs rarely. */
let handlePids = new Map<string, number>();
let handlePidsKey = "";
let lastPowerShell = 0;

/**
 * Find which window handles belong to the given processes with
 * `Get-Process`. This is the only reliable owner lookup on Windows, since
 * `desktopCapturer` gives just the handle and the title. Only the main
 * window of each process is reported.
 *
 * @param pids Processes of matched games
 * @returns Handle (as a string) to pid
 */
async function queryWindowHandles(
  pids: number[],
): Promise<Map<string, number>> {
  const script =
    `ConvertTo-Json -Compress -InputObject @(Get-Process -Id ${pids.join(",")} ` +
    "-ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } " +
    "| Select-Object Id, @{n='H';e={[string][int64]$_.MainWindowHandle}})";
  const output = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    4_000,
  );
  const result = new Map<string, number>();
  try {
    const parsed: unknown = JSON.parse(output?.trim() || "[]");
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (typeof item?.Id === "number" && typeof item?.H === "string")
        result.set(item.H, item.Id);
    }
  } catch {
    // Unusable output, windows stay unmapped this round
  }
  return result;
}

/**
 * Map windows to processes on Windows. PowerShell only runs when the
 * matched processes changed, a known window vanished, or a game still has
 * no window (at most every few seconds).
 *
 * @param matches Matched games
 * @param sources All capturable windows
 * @returns Windows with owners
 */
async function mapWindowsWin32(
  matches: GameMatch[],
  sources: Electron.DesktopCapturerSource[],
): Promise<WindowInfo[]> {
  const pids = matches.flatMap((match) => match.pids).sort((a, b) => a - b);
  const key = pids.join(",");
  const open = new Set(sources.map((source) => windowIdOf(source.id)));
  const now = Date.now();

  const changed = key !== handlePidsKey;
  const vanished = [...handlePids.keys()].some((handle) => !open.has(handle));
  const missing =
    now - lastPowerShell > POWERSHELL_RETRY_MS &&
    matches.some(
      (match) =>
        ![...handlePids.values()].some((pid) => match.pids.includes(pid)),
    );
  if (changed || vanished || missing) {
    handlePids = await queryWindowHandles(pids);
    handlePidsKey = key;
    lastPowerShell = Date.now();
  }

  return sources.flatMap((source) => {
    const handle = windowIdOf(source.id);
    const pid = handle ? handlePids.get(handle) : undefined;
    return pid === undefined
      ? []
      : [{ sourceId: source.id, title: source.name, pid }];
  });
}

/** X11 window id to pid (null: has none), kept so xprop runs once per window. */
const xidPids = new Map<string, { pid: number | null; scan: number }>();

/** Scan counter, used to retry windows that had no pid yet. */
let scanCount = 0;
/** Scans to wait before asking again for a window without a pid. */
const XPROP_RETRY_SCANS = 3;

/** Whether xprop is installed, checked once. */
let xpropAvailable: Promise<boolean> | undefined;

/**
 * Map windows to processes on X11 with `xprop _NET_WM_PID`. Does nothing
 * if xprop isn't installed.
 *
 * @param sources All capturable windows
 * @returns Windows with owners
 */
async function mapWindowsX11(
  sources: Electron.DesktopCapturerSource[],
): Promise<WindowInfo[]> {
  xpropAvailable ??= run("xprop", ["-version"]).then(
    (out) => out !== undefined,
  );
  if (!(await xpropAvailable)) return [];

  const ids = sources.map((source) => windowIdOf(source.id));
  // Forget windows that closed, so a reused id is looked up again
  const alive = new Set(ids);
  for (const id of [...xidPids.keys()]) if (!alive.has(id)) xidPids.delete(id);

  await Promise.all(
    ids.map(async (id) => {
      const known = id ? xidPids.get(id) : undefined;
      // Proton sets the pid late, so windows without one are asked again
      if (
        !id ||
        (known &&
          (known.pid !== null || scanCount - known.scan < XPROP_RETRY_SCANS))
      )
        return;
      const output = await run("xprop", ["-id", id, "_NET_WM_PID"]);
      xidPids.set(id, {
        pid: output ? (parseXpropPid(output) ?? null) : null,
        scan: scanCount,
      });
    }),
  );

  return sources.flatMap((source, index) => {
    const pid = xidPids.get(ids[index] ?? "")?.pid;
    return typeof pid === "number"
      ? [{ sourceId: source.id, title: source.name, pid }]
      : [];
  });
}

/**
 * Look at the processes and windows once.
 *
 * @returns The detected games and whether any game runs
 */
async function detect(): Promise<RunningGame[]> {
  if (!platform) return [];
  scanCount++;
  entries ??= loadEntries();
  const procs = await listProcesses();
  const matches = matchGames(entries, procs, platform);
  if (matches.length === 0) {
    handlePids.clear();
    handlePidsKey = "";
    xidPids.clear();
    return [];
  }

  let windows: WindowInfo[] = [];
  // On Wayland getSources() opens the portal picker, so never call it
  if (!isWayland) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 0, height: 0 },
      });
      windows =
        platform === "win32"
          ? await mapWindowsWin32(matches, sources)
          : await mapWindowsX11(sources);
    } catch (error) {
      console.error("Game window lookup failed", error);
    }
  }
  return buildRunningGames(matches, procs, windows, platform);
}

/**
 * Send a list to the app window.
 *
 * @param games Detected games
 */
function publish(games: RunningGame[]) {
  const target = getTarget();
  // Not to the error page, nor after the window navigated away
  if (target && !target.isDestroyed() && isServerUrl(target.getURL()))
    target.send(IPC.gamesChanged, games);
}

/** Scan, publish if something changed, and plan the next scan. */
function scan() {
  if (scanning || !enabled) return;
  scanning = (async () => {
    try {
      const games = await detect();
      // Detection may have been switched off while we were scanning
      if (enabled && !sameRunningGames(games, latest)) {
        latest = games;
        publish(games);
      }
    } catch (error) {
      console.error("Game detection failed", error);
    }
  })().finally(() => {
    scanning = undefined;
    if (!enabled) return;
    timer = setTimeout(
      scan,
      latest.length > 0 ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS,
    );
  });
}

/**
 * Turn detection on or off at runtime. Turning it off stops polling and
 * tells the page the list is empty.
 *
 * @param value Whether detection should run
 */
export function setGameDetection(value: boolean) {
  if (value === enabled) return;
  enabled = value;
  if (enabled) {
    // Reload the user's list too, so edits show up after a toggle
    entries = undefined;
    scan();
    return;
  }
  clearTimeout(timer);
  timer = undefined;
  if (latest.length > 0) {
    latest = [];
    publish([]);
  }
}

/**
 * Whether a source id is a window of a currently detected game.
 *
 * @param sourceId A `desktopCapturer` source id
 * @returns True only for windows in the latest list
 */
export function isGameWindow(sourceId: string): boolean {
  return (
    enabled &&
    latest.some((game) =>
      game.windows.some((window) => window.sourceId === sourceId),
    )
  );
}

/**
 * The games found by the last scan.
 *
 * @returns Matched games only, empty when detection is off
 */
export async function getRunningGames(): Promise<RunningGame[]> {
  if (!enabled) return [];
  await scanning;
  return latest;
}

/**
 * Start game detection, call once the app is ready.
 *
 * @param target Gives the window that receives updates
 * @param initiallyEnabled The stored `gameDetection` setting
 */
export function installGameDetection(
  target: () => Electron.WebContents | undefined,
  initiallyEnabled: boolean,
) {
  getTarget = target;
  setGameDetection(initiallyEnabled);
}
