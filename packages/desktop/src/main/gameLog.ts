import { app } from "electron";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** Size at which the log is moved to `games.log.1`. */
const MAX_LOG_BYTES = 1024 * 1024;

/**
 * Append a line to `userData/logs/games.log` for diagnosing game detection.
 * The file rotates once (to `.1`) at about 1 MB. Never throws.
 *
 * @param message What happened, without unrelated processes or window titles
 */
export function gameLog(message: string) {
  try {
    const dir = join(app.getPath("userData"), "logs");
    const file = join(dir, "games.log");
    mkdirSync(dir, { recursive: true });
    try {
      if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, file + ".1");
    } catch {
      // No file yet
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break detection
  }
}
