/** What to do with the TLS key log when the app starts. */
export type TlsKeyLogStartup =
  /** Setting is off: make sure no file remains */
  | "off"
  /** Setting is on for this version: write keys */
  | "on"
  /** Setting was on in another version: switch it off and delete the file */
  | "reset";

/**
 * Decide what the TLS key log does at startup. An app update switches it off,
 * so a forgotten key log doesn't stay on for good.
 *
 * @param enabled The stored setting
 * @param storedVersion App version the setting was switched on in
 * @param currentVersion Running app version
 */
export function tlsKeyLogStartup(
  enabled: boolean,
  storedVersion: string,
  currentVersion: string,
): TlsKeyLogStartup {
  if (!enabled) return "off";
  return storedVersion === currentVersion ? "on" : "reset";
}
