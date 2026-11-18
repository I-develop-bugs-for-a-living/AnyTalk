import { gameLog } from "./gameLog";
import { windowIdOf } from "./gameMatch";
import { gameNameOfWindow, run } from "./games";
import { isWayland } from "./platform";
import {
  type ProgramInfo,
  chooseLabel,
  encodePowerShell,
  parseProgramInfo,
  parseWmClass,
  presentableName,
  processNameByTitle,
  sanitizeLabel,
} from "./sourceLabel";

/**
 * Looks up the program that owns a window handle: the process whose main
 * window it is, and its executable's description. No Add-Type (that compiles
 * C# and is slow). The handle is digits only, see `windowIdOf`. Prints one
 * JSON line, nothing when the lookup fails.
 */
function windowProgramScript(handle: string): string {
  return (
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    "$ErrorActionPreference='SilentlyContinue'; " +
    "$o=@{n='';d='';p=''}; " +
    `$x=Get-Process | Where-Object { $_.MainWindowHandle -eq [int64]${handle} } | Select-Object -First 1; ` +
    "if($x){$o.n=$x.ProcessName; try{$v=$x.MainModule.FileVersionInfo; " +
    "$o.d=$v.FileDescription; $o.p=$v.ProductName}catch{}}; " +
    "ConvertTo-Json -Compress -InputObject $o"
  );
}

/** How long the PowerShell lookup may take before it is given up. */
const POWERSHELL_TIMEOUT_MS = 8_000;

/**
 * Ask PowerShell for the program of a window, logging how it went.
 *
 * @param sourceId The source id, for the log
 * @param handle The window handle (digits)
 * @returns The program info (undefined when PowerShell gave nothing usable)
 *   and whether it ran into the time limit
 */
async function lookupWithPowerShell(
  sourceId: string,
  handle: string,
): Promise<{ info?: ProgramInfo; timedOut: boolean }> {
  const started = Date.now();
  const output = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShell(windowProgramScript(handle)),
    ],
    POWERSHELL_TIMEOUT_MS,
  );
  const took = Date.now() - started;
  // run() hides why it failed: taking the whole limit means a timeout
  const timedOut = took >= POWERSHELL_TIMEOUT_MS - 200;
  if (output === undefined) {
    gameLog(
      `label ${sourceId}: PowerShell failed or timed out after ${took} ms`,
    );
    return { timedOut };
  }
  const info = parseProgramInfo(output);
  if (!info || (!info.name && !info.description && !info.product)) {
    gameLog(
      `label ${sourceId}: PowerShell gave no program (${took} ms, output "${output.trim().slice(0, 120)}")`,
    );
    return { timedOut };
  }
  gameLog(
    `label ${sourceId}: PowerShell found ${info.name ?? "?"} / ${info.description ?? "?"} (${took} ms)`,
  );
  return { info, timedOut };
}

/**
 * Fallback without PowerShell: match the window title against the window
 * titles `tasklist /v` lists, to get at least the process name. tasklist
 * prints in the OEM code page, so titles with non-ASCII characters won't
 * match and give nothing.
 *
 * @param sourceId The source id, for the log
 * @param title The window title
 * @returns The program (name only), or undefined
 */
async function lookupWithTasklist(
  sourceId: string,
  title: string,
): Promise<ProgramInfo | undefined> {
  const output = await run("tasklist", ["/v", "/fo", "csv", "/nh"], 8_000);
  const name = output ? processNameByTitle(output, title) : undefined;
  gameLog(
    `label ${sourceId}: tasklist fallback ${name ? `found ${name}` : output === undefined ? "failed" : "found no unique process"}`,
  );
  return name ? { name } : undefined;
}

/**
 * Work out what to call a captured window for the viewers of the stream: the
 * detected game's name, else the name of the program that owns the window.
 * Screens get no label. The window title is not used, it can hold private
 * text, with one exception: Java runtimes only report themselves ("OpenJDK
 * Platform binary"), so Java programs are labelled by their window title
 * (see `chooseLabel`). A failed lookup (or Wayland, which has no window id)
 * gives no label. Never rejects. On Windows the PowerShell lookup and the
 * tasklist fallback can each take up to 8 seconds (the fallback is skipped
 * after a timeout), so callers start this in the background and must not
 * wait for it on a hot path.
 *
 * @param source The captured source
 * @returns The label, or undefined when there is none
 */
export async function resolveSourceLabel(
  source: Electron.DesktopCapturerSource,
): Promise<string | undefined> {
  if (!source.id.startsWith("window:")) return undefined;
  const game = gameNameOfWindow(source.id);
  gameLog(`label ${source.id}: game match ${game ?? "none"}`);
  if (game) return sanitizeLabel(game);

  const id = windowIdOf(source.id);
  let label: string | undefined;
  try {
    if (id && process.platform === "win32") {
      const found = await lookupWithPowerShell(source.id, id);
      // after a PowerShell timeout the fallback is skipped: the lookup
      // would take up to twice as long for a system that is already slow
      const info =
        found.info ??
        (found.timedOut
          ? undefined
          : await lookupWithTasklist(source.id, source.name));
      label = chooseLabel(info, source.name);
    } else if (id && process.platform === "linux" && !isWayland) {
      const output = await run("xprop", ["-id", id, "WM_CLASS"], 2_000);
      const wmClass = output ? parseWmClass(output) : undefined;
      label = chooseLabel(
        wmClass
          ? { name: wmClass, description: presentableName(wmClass) }
          : undefined,
        source.name,
      );
    } else gameLog(`label ${source.id}: no window id or unsupported platform`);
  } catch (error) {
    gameLog(`label ${source.id}: lookup threw ${String(error)}`);
  }
  gameLog(`label ${source.id}: chose ${label ? `"${label}"` : "none"}`);
  return label;
}
