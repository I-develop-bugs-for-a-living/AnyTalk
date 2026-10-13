import type { GameEntry } from "../shared/games";
import type { RunningGame, RunningGameWindow } from "../shared/ipc";

/** A process as seen by the scanner: its id and every name it goes by. */
export type ProcInfo = { pid: number; names: string[] };

/** A capturable window, with the owning process once it is known. */
export type WindowInfo = { sourceId: string; title: string; pid?: number };

/** A game entry together with the processes that matched it. */
export type GameMatch = { entry: GameEntry; pids: number[]; names: string[] };

/**
 * Last path segment of a Windows or POSIX path, lower-cased.
 *
 * @param path Path or bare file name
 * @returns The lower-cased base name
 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop()!.trim().toLowerCase();
}

/** Windows `tasklist` may cut image names to this many characters. */
const TASKLIST_NAME_LIMIT = 25;

/**
 * Key two process names are compared by. On Windows only the first 25
 * characters count, since `tasklist` can truncate long image names, so full
 * and cut names both match. Linux compares full names.
 *
 * @param name Lower-cased process name
 * @param platform The OS the shell runs on
 * @returns The comparison key
 */
export function matchKey(name: string, platform: "win32" | "linux"): string {
  return platform === "win32" ? name.slice(0, TASKLIST_NAME_LIMIT) : name;
}

/**
 * Executable names that make an entry count as running on a platform.
 * Linux also accepts the Windows names, as Proton/Wine show them.
 *
 * @param entry The game entry
 * @param platform The OS the shell runs on
 * @returns Lower-cased names
 */
export function executablesFor(
  entry: GameEntry,
  platform: "win32" | "linux",
): string[] {
  const list =
    platform === "win32"
      ? (entry.executables.win32 ?? [])
      : [
          ...(entry.executables.linux ?? []),
          ...(entry.executables.win32 ?? []),
        ];
  return list.map((name) => name.toLowerCase());
}

/**
 * Find the entries that have a running process.
 *
 * @param entries Known games
 * @param procs All running processes
 * @param platform The OS the shell runs on
 * @returns One match per running entry, in list order
 */
export function matchGames(
  entries: GameEntry[],
  procs: ProcInfo[],
  platform: "win32" | "linux",
): GameMatch[] {
  // One lookup for all entries instead of a scan per entry
  const owners = new Map<string, GameEntry[]>();
  for (const entry of entries) {
    for (const exe of executablesFor(entry, platform)) {
      const key = matchKey(exe, platform);
      const list = owners.get(key) ?? [];
      list.push(entry);
      owners.set(key, list);
    }
  }

  const found = new Map<GameEntry, GameMatch>();
  for (const proc of procs) {
    for (const name of proc.names) {
      for (const entry of owners.get(matchKey(name, platform)) ?? []) {
        const match = found.get(entry) ?? { entry, pids: [], names: [] };
        if (!match.pids.includes(proc.pid)) match.pids.push(proc.pid);
        if (!match.names.includes(name)) match.names.push(name);
        found.set(entry, match);
      }
    }
  }
  return entries.flatMap((entry) => found.get(entry) ?? []);
}

/**
 * Role of a process of an entry: a client when it is one of the listed
 * client executables, otherwise the game itself.
 *
 * @param entry The game entry
 * @param names Every name of the process
 * @returns The window role
 */
export function roleFor(
  entry: GameEntry,
  names: string[],
): RunningGameWindow["role"] {
  const clients = (entry.clients ?? []).map((name) => name.toLowerCase());
  return names.some((name) => clients.includes(name)) ? "client" : "game";
}

/**
 * Display name of a matched entry: the `gameNames` entry of a running
 * process if there is one, otherwise the entry's own name.
 *
 * @param match The matched entry with the names of its running processes
 * @param platform The OS the shell runs on
 * @returns The name to show
 */
export function displayNameFor(
  match: GameMatch,
  platform: "win32" | "linux",
): string {
  const map = match.entry.gameNames;
  if (!map) return match.entry.name;
  const byKey = new Map(
    Object.entries(map).map(([exe, name]) => [
      matchKey(exe.toLowerCase(), platform),
      name,
    ]),
  );
  for (const name of match.names) {
    const found = byKey.get(matchKey(name, platform));
    if (found) return found;
  }
  return match.entry.name;
}

/** A window of a game and how it was assigned. */
export type AssignedWindow = RunningGameWindow & { via: "handle" | "title" };

/** Retry bookkeeping for a process whose window handle is not known yet. */
export type HandleTry = { since: number; lastTry: number };

/** After this long without a handle a process is retried less often. */
const HANDLE_BACKOFF_AFTER_MS = 30_000;
/** Retry interval for a process that just started. */
const HANDLE_RETRY_MS = 4_000;
/** Retry interval for a process that stays windowless (stubs, helpers). */
const HANDLE_SLOW_RETRY_MS = 15_000;

/**
 * Decide whether the window handles should be asked for again. Per process:
 * any matched pid without a handle is retried, throttled, and backed off
 * once it has been windowless for a long time.
 *
 * @param pids Matched pids
 * @param mapped Pids that already have a handle
 * @param state Retry bookkeeping, pruned here
 * @param now Current time in ms
 * @returns Whether a query is due
 */
export function needsHandleQuery(
  pids: number[],
  mapped: Set<number>,
  state: Map<number, HandleTry>,
  now: number,
): boolean {
  for (const pid of [...state.keys()]) {
    if (!pids.includes(pid) || mapped.has(pid)) state.delete(pid);
  }
  let due = false;
  for (const pid of pids) {
    if (mapped.has(pid)) continue;
    const entry = state.get(pid) ?? { since: now, lastTry: 0 };
    state.set(pid, entry);
    const interval =
      now - entry.since > HANDLE_BACKOFF_AFTER_MS
        ? HANDLE_SLOW_RETRY_MS
        : HANDLE_RETRY_MS;
    if (now - entry.lastTry >= interval) due = true;
  }
  return due;
}

/**
 * Record that the handles were just asked for.
 *
 * @param state Retry bookkeeping from `needsHandleQuery`
 * @param now Current time in ms
 */
export function noteHandleQuery(state: Map<number, HandleTry>, now: number) {
  for (const entry of state.values()) entry.lastTry = now;
}

/**
 * Assign windows to running games: first by owning process, then, for roles
 * that still have no window, by the entry's exact window titles. Windows
 * that fit no running game are dropped here, so they never leave the shell.
 *
 * @param matches Running entries
 * @param procs All running processes, to look up names by pid
 * @param windows All capturable windows, `pid` set when the owner is known
 * @param platform The OS the shell runs on, for matching `gameNames`
 * @returns Games with windows ordered game first, then client, then id
 */
export function assignWindows(
  matches: GameMatch[],
  procs: ProcInfo[],
  windows: WindowInfo[],
  platform: "win32" | "linux" = "win32",
): { id: string; name: string; windows: AssignedWindow[] }[] {
  const namesByPid = new Map(procs.map((proc) => [proc.pid, proc.names]));
  return matches.map((match) => {
    const { entry, pids } = match;
    const own: AssignedWindow[] = [];
    for (const window of windows) {
      if (window.pid === undefined || !pids.includes(window.pid)) continue;
      if (own.some((item) => item.sourceId === window.sourceId)) continue;
      own.push({
        sourceId: window.sourceId,
        title: window.title,
        role: roleFor(entry, namesByPid.get(window.pid) ?? []),
        via: "handle",
      });
    }
    for (const role of ["game", "client"] as const) {
      const titles = (entry.windowTitles?.[role] ?? []).map((t) =>
        t.toLowerCase(),
      );
      if (titles.length === 0 || own.some((item) => item.role === role))
        continue;
      // Only windows with no known owner. On Windows that includes every
      // unrelated window (only matched processes are mapped), so this matches
      // any unowned window with exactly this title.
      for (const window of windows) {
        if (window.pid !== undefined) continue;
        if (!titles.includes(window.title.toLowerCase())) continue;
        if (own.some((item) => item.sourceId === window.sourceId)) continue;
        own.push({
          sourceId: window.sourceId,
          title: window.title,
          role,
          via: "title",
        });
      }
    }
    // Game windows first, then by source id inside each role, so z-order
    // changes in the scan don't look like a change of the list
    own.sort(
      (a, b) =>
        Number(a.role === "client") - Number(b.role === "client") ||
        a.sourceId.localeCompare(b.sourceId),
    );
    return {
      id: entry.id,
      name: displayNameFor(match, platform),
      windows: own,
    };
  });
}

/**
 * Turn matches and the windows of their processes into the list the page
 * gets, see `assignWindows`.
 *
 * @param matches Running entries
 * @param procs All running processes, to look up names by pid
 * @param windows All capturable windows
 * @param platform The OS the shell runs on, for matching `gameNames`
 * @returns The games as the page sees them
 */
export function buildRunningGames(
  matches: GameMatch[],
  procs: ProcInfo[],
  windows: WindowInfo[],
  platform: "win32" | "linux" = "win32",
): RunningGame[] {
  return assignWindows(matches, procs, windows, platform).map((game) => ({
    ...game,
    windows: game.windows.map(({ sourceId, title, role }) => ({
      sourceId,
      title,
      role,
    })),
  }));
}

/**
 * Compare two lists by value.
 *
 * @param a First list
 * @param b Second list
 * @returns Whether ids, names and windows (in order) are equal
 */
export function sameRunningGames(a: RunningGame[], b: RunningGame[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Read the process names out of `tasklist /fo csv /nh` output.
 *
 * @param output Raw output
 * @returns One entry per process
 */
export function parseTasklist(output: string): ProcInfo[] {
  const result: ProcInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^"([^"]*)","(\d+)"/.exec(line);
    if (match)
      result.push({ pid: Number(match[2]), names: [match[1].toLowerCase()] });
  }
  return result;
}

/** Programs whose command line is ignored when looking for games. */
const IGNORED_TOOLS = new Set([
  "grep",
  "rg",
  "less",
  "more",
  "cat",
  "tail",
  "head",
  "vim",
  "nvim",
  "nano",
  "code",
  "sh",
  "bash",
  "zsh",
  "fish",
  "reaper",
  "pressure-vessel-wrap",
  "pressure-vessel-adverb",
  "pressure-vessel-launch",
]);

/**
 * Build the names of a Linux process from `/proc` data. Includes `comm`
 * (cut to 15 characters by the kernel), the base name of argv[0] and of any
 * argument that is a `.exe` path, which is how Wine/Proton show the game.
 *
 * @param comm Contents of `/proc/<pid>/comm`
 * @param cmdline Contents of `/proc/<pid>/cmdline`, NUL separated
 * @returns Distinct lower-cased names
 */
export function linuxNames(comm: string, cmdline: string): string[] {
  const names = new Set<string>();
  const args = cmdline.split("\0").filter(Boolean);
  // Tools and wrappers that merely have a game's .exe on their command line
  // (editors, pagers, shells, Steam's reaper/pressure-vessel). Other programs
  // that only mention an .exe path can still cause a false positive.
  if (args[0] && IGNORED_TOOLS.has(baseName(args[0]))) return [];
  const trimmedComm = comm.trim().toLowerCase();
  if (trimmedComm) names.add(trimmedComm);
  if (args[0]) names.add(baseName(args[0]));
  for (const arg of args) {
    // Spaces are allowed in game names, so test the whole argument
    if (/\.exe$/i.test(arg)) names.add(baseName(arg));
  }
  return [...names];
}

/**
 * Read the window handle or id from a `desktopCapturer` source id.
 *
 * @param sourceId e.g. `window:123456:0`
 * @returns The second part, or undefined for other sources
 */
export function windowIdOf(sourceId: string): string | undefined {
  const match = /^window:(\d+)(?::|$)/.exec(sourceId);
  return match?.[1];
}

/**
 * Read the pid out of `xprop _NET_WM_PID` output.
 *
 * @param output e.g. `_NET_WM_PID(CARDINAL) = 1234`
 * @returns The pid, or undefined if the window has none
 */
export function parseXpropPid(output: string): number | undefined {
  const match = /_NET_WM_PID\(CARDINAL\)\s*=\s*(\d+)/.exec(output);
  return match ? Number(match[1]) : undefined;
}

/**
 * Reject if a promise doesn't settle in time, so a hung system call can't
 * stall the scan loop.
 *
 * @param promise What to wait for
 * @param ms Time limit in milliseconds
 * @param what Name used in the error
 * @returns The promise result
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${what} timed out after ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
}
