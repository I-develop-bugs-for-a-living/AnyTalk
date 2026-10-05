import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { APP_ID } from "./platform";

/** XDG autostart entry location (Linux). */
const desktopFile = () =>
  join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "autostart",
    `${APP_ID}.desktop`,
  );

/**
 * Quote a path for the Exec key of a .desktop file. `%` starts a field code
 * there, so it is doubled to stay literal.
 */
export const quote = (path: string) =>
  `"${path.replace(/(["`$\\])/g, "\\$1").replace(/%/g, "%%")}"`;

/**
 * Whether AnyTalk starts at login.
 *
 * @returns True if enabled
 */
export function getAutostart(): boolean {
  if (process.platform === "win32")
    return app.getLoginItemSettings().openAtLogin;
  if (process.platform === "linux") return existsSync(desktopFile());
  return false;
}

/**
 * Turn start at login on or off.
 *
 * @param enabled Desired state
 * @returns The state after the change
 */
export function setAutostart(enabled: boolean): boolean {
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } else if (process.platform === "linux") {
    try {
      if (enabled) {
        // AppImages move around, so point at the image, not the temp mount
        const exec = process.env.APPIMAGE || process.execPath;
        mkdirSync(join(desktopFile(), ".."), { recursive: true });
        writeFileSync(
          desktopFile(),
          [
            "[Desktop Entry]",
            "Type=Application",
            "Name=AnyTalk",
            `Exec=${quote(exec)}`,
            `Icon=${process.env.APPIMAGE ? APP_ID : "anytalk"}`,
            `StartupWMClass=${APP_ID}`,
            "Terminal=false",
            "X-GNOME-Autostart-enabled=true",
            "",
          ].join("\n"),
        );
      } else {
        rmSync(desktopFile(), { force: true });
      }
    } catch (error) {
      console.error("Failed to change autostart", error);
    }
  }
  return getAutostart();
}
