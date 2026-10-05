import { getConfig } from "./config";

/** Build-time default server URL. */
export const DEFAULT_URL: string = __DEFAULT_URL__;

/**
 * Check that a string is an http(s) URL.
 *
 * @param value Candidate URL
 * @returns The normalised URL, or undefined if invalid
 */
export function parseHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The URL the window should load: runtime env override, then the user's
 * custom URL, then the build-time default.
 *
 * @returns An http(s) URL
 */
export function effectiveUrl(): string {
  return (
    parseHttpUrl(process.env.ANYTALK_URL ?? "") ??
    parseHttpUrl(getConfig().serverUrl) ??
    DEFAULT_URL
  );
}

/**
 * Origin of the server the app currently talks to.
 *
 * @returns Origin such as `https://chat.example.com`
 */
export function serverOrigin(): string {
  return new URL(effectiveUrl()).origin;
}

/**
 * Whether a URL belongs to the current server origin.
 *
 * @param url Any URL string
 * @returns True if same origin
 */
export function isServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === serverOrigin();
  } catch {
    return false;
  }
}
