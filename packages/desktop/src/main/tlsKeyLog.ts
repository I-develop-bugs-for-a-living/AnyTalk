import { type BrowserWindow, app, dialog, shell } from "electron";
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TlsKeyLogResult, TlsKeyLogState } from "../shared/ipc";
import { getConfig, updateConfig } from "./config";
import { tlsKeyLogStartup } from "./tlsKeyLogLogic";

/** Whether Chromium writes keys in this session (set by `installTlsKeyLog`). */
let active = false;

/** Path of the key log file in the user data directory. */
function keyLogPath(): string {
  return join(app.getPath("userData"), "tls-keys.log");
}

/** Delete the key log file, ignoring a missing or locked file. */
function deleteKeyLog() {
  try {
    rmSync(keyLogPath(), { force: true });
  } catch (error) {
    console.error("[tls-key-log] could not delete the file:", error);
  }
}

/**
 * Make sure the key log file exists and only the user can read it. Chromium
 * opens the file in append mode (`fopen(path, "a")`), so a file created here
 * with mode 0600 keeps its permissions. Best effort: on Windows the mode is
 * ignored, and a failure only means the default permissions apply.
 */
function secureKeyLogFile() {
  try {
    writeFileSync(keyLogPath(), "", { flag: "a", mode: 0o600 });
    if (process.platform !== "win32") chmodSync(keyLogPath(), 0o600);
  } catch (error) {
    console.error("[tls-key-log] could not restrict the file:", error);
  }
}

/**
 * Apply the TLS key log setting at startup. Must run before the app is ready:
 * Chromium reads the `ssl-key-log-file` switch when its network service
 * starts. With the setting off (or reset by an update) the file is deleted,
 * in case one remained from a session that was writing it.
 */
export function installTlsKeyLog() {
  const config = getConfig();
  switch (
    tlsKeyLogStartup(
      config.tlsKeyLog,
      config.tlsKeyLogVersion,
      app.getVersion(),
    )
  ) {
    case "on":
      secureKeyLogFile();
      app.commandLine.appendSwitch("ssl-key-log-file", keyLogPath());
      active = true;
      break;
    case "reset":
      updateConfig({ tlsKeyLog: false, tlsKeyLogVersion: "" });
      deleteKeyLog();
      break;
    case "off":
      deleteKeyLog();
      break;
  }
}

/** Current state of the option. */
export function getTlsKeyLogState(): TlsKeyLogState {
  return {
    enabled: getConfig().tlsKeyLog,
    active,
    path: keyLogPath(),
    exists: existsSync(keyLogPath()),
  };
}

/**
 * Switch the option on or off. Switching on first asks in a native dialog
 * (the page cannot skip or fake it): the file lets anyone holding it read the
 * recorded traffic, and it takes effect after a restart. Switching off only
 * stops writing at the next start and deletes the file then (or now, when no
 * session is writing it).
 *
 * @param enabled The wanted setting
 * @param parent Window the dialog belongs to
 * @returns The new state; `restarting` is true when the user chose "Restart
 * now" (the caller relaunches the app)
 */
export async function setTlsKeyLog(
  enabled: boolean,
  parent: BrowserWindow | undefined,
): Promise<TlsKeyLogResult> {
  if (enabled === getConfig().tlsKeyLog) {
    return { ...getTlsKeyLogState(), restarting: false };
  }

  if (!enabled) {
    updateConfig({ tlsKeyLog: false, tlsKeyLogVersion: "" });
    if (!active) deleteKeyLog();
    return { ...getTlsKeyLogState(), restarting: false };
  }

  // English only: the main process has no Lingui, like its other native text
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "TLS key log",
    message: "Write the TLS key log file?",
    detail:
      "The file holds the keys of your secure connections. Anyone who gets " +
      "it, together with a packet capture of your traffic, can read what was " +
      "recorded, including messages and sign-in data. It takes effect after " +
      "a restart, and switches off again when the app updates.\n\n" +
      `File: ${keyLogPath()}`,
    buttons: ["Restart now", "Later", "Cancel"],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response === 2) {
    return { ...getTlsKeyLogState(), restarting: false };
  }
  updateConfig({ tlsKeyLog: true, tlsKeyLogVersion: app.getVersion() });
  return { ...getTlsKeyLogState(), restarting: response === 0 };
}

/**
 * Show the key log file in the system file manager.
 *
 * @returns False when there is no file yet
 */
export function revealTlsKeyLog(): boolean {
  if (!existsSync(keyLogPath())) return false;
  shell.showItemInFolder(keyLogPath());
  return true;
}
