import { app } from "electron";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { quote } from "./autostart";
import { APP_ID } from "./platform";

/** Directories that may hold the app's desktop file, user directory first. */
function applicationDirs(): string[] {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
  const dataDirs = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
    .split(delimiter)
    .filter(Boolean);
  return [dataHome, ...dataDirs].map((dir) => join(dir, "applications"));
}

/**
 * Make sure a `<APP_ID>.desktop` file exists, because the Wayland shortcuts
 * portal refuses apps it can't find one for. Installed packages ship their
 * own, so this only writes one for AppImage and dev runs, and rewrites it
 * when its Exec path went stale (e.g. the AppImage was moved).
 *
 * Runs synchronously and must be called before the app is ready.
 */
export function ensureLinuxDesktopFile() {
  const appImage = process.env.APPIMAGE;
  // deb, rpm and pacman installs bring their own desktop file
  if (app.isPackaged && !appImage) return;

  try {
    const target = join(homedir(), ".local/share/applications");
    const file = join(target, `${APP_ID}.desktop`);
    const found = applicationDirs().some((dir) =>
      existsSync(join(dir, `${APP_ID}.desktop`)),
    );

    const lines = ["[Desktop Entry]", "Type=Application", "Name=AnyTalk"];
    if (appImage) {
      // Copy the icon out of the AppImage mount, which disappears on exit
      const iconDir = join(
        homedir(),
        ".local/share/icons/hicolor/512x512/apps",
      );
      mkdirSync(iconDir, { recursive: true });
      copyFileSync(join(__dirname, "icon.png"), join(iconDir, `${APP_ID}.png`));
      lines.push(
        "Comment=AnyTalk chat client",
        `Exec=${quote(appImage)} %U`,
        `Icon=${APP_ID}`,
        "Categories=Network;InstantMessaging;",
      );
    } else {
      // Dev run: only here for the portal, so keep it out of launchers
      lines.push(
        `Exec=${[process.execPath, app.getAppPath()].map(quote).join(" ")}`,
        "NoDisplay=true",
      );
    }
    lines.push(`StartupWMClass=${APP_ID}`, "Terminal=false", "");
    const content = lines.join("\n");

    // A file in a system directory is fine, ours is only rewritten if stale
    if (found && !existsSync(file)) return;
    if (existsSync(file) && readFileSync(file, "utf8") === content) return;
    mkdirSync(target, { recursive: true });
    writeFileSync(file, content);
  } catch (error) {
    console.error("Failed to write the desktop file", error);
  }
}
