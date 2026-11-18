import { windowIdOf } from "./gameMatch";
import { gameNameOfWindow, run } from "./games";
import { isWayland } from "./platform";
import {
  chooseLabel,
  parseProgramInfo,
  parseWmClass,
  presentableName,
  sanitizeLabel,
} from "./sourceLabel";

/**
 * Looks up the program that owns a window handle: user32 gives the process,
 * its executable carries the description. The handle is digits only, see
 * `windowIdOf`. Prints one JSON line, nothing when the lookup fails.
 */
function windowProgramScript(handle: string): string {
  return (
    "$ErrorActionPreference='SilentlyContinue'; " +
    "Add-Type -Name P -Namespace F -MemberDefinition " +
    '\'[DllImport("user32.dll")] public static extern uint ' +
    "GetWindowThreadProcessId(System.IntPtr h, out uint p);'; " +
    "$p=[uint32]0; " +
    `[void][F.P]::GetWindowThreadProcessId([System.IntPtr][int64]${handle},[ref]$p); ` +
    "$o=@{n='';d='';p=''}; $x=Get-Process -Id $p; " +
    "if($x){$o.n=$x.ProcessName; try{$v=$x.MainModule.FileVersionInfo; " +
    "$o.d=$v.FileDescription; $o.p=$v.ProductName}catch{}}; " +
    "ConvertTo-Json -Compress -InputObject $o"
  );
}

/**
 * Work out what to call a captured window for the viewers of the stream: the
 * detected game's name, else the name of the program that owns the window.
 * Screens get no label. The window title is never used: a failed lookup (or
 * Wayland, which has no window id) gives no label. Never rejects. The first
 * Windows lookup
 * compiles C# through Add-Type, which takes about a second, so callers start
 * it in the background and must not wait for it on a hot path.
 *
 * @param source The captured source
 * @returns The label, or undefined when there is none
 */
export async function resolveSourceLabel(
  source: Electron.DesktopCapturerSource,
): Promise<string | undefined> {
  if (!source.id.startsWith("window:")) return undefined;
  const game = gameNameOfWindow(source.id);
  if (game) return sanitizeLabel(game);

  const id = windowIdOf(source.id);
  let label: string | undefined;
  try {
    if (id && process.platform === "win32") {
      const output = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", windowProgramScript(id)],
        8_000,
      );
      const info = output ? parseProgramInfo(output) : undefined;
      label = chooseLabel(info);
    } else if (id && process.platform === "linux" && !isWayland) {
      const output = await run("xprop", ["-id", id, "WM_CLASS"], 2_000);
      const wmClass = output ? parseWmClass(output) : undefined;
      label = chooseLabel(
        wmClass ? { description: presentableName(wmClass) } : undefined,
      );
    }
  } catch {
    // no label
  }
  return label;
}
