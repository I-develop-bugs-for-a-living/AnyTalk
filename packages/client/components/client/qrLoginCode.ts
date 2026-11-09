/**
 * Encoding and parsing of the content of a login QR code.
 *
 * The QR code holds a URL (`<origin>/qr-login#<id>`) so a phone's normal
 * camera could open it later. Only the request id goes in the code; the
 * secret never leaves the device that shows it.
 */

/** Path of the QR login URL */
export const QR_LOGIN_PATH = "/qr-login";

/** A request id is exactly 32 URL-safe characters */
const QR_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/**
 * Whether a string is a well-formed QR login request id
 * @param id Candidate id
 */
export function isQrLoginId(id: string): boolean {
  return QR_ID_PATTERN.test(id);
}

/**
 * Build the content of the QR code for a request id
 * @param id Request id
 * @param origin Origin of this app, e.g. `https://chat.example.com`
 */
export function encodeQrLogin(id: string, origin: string): string {
  return `${origin}${QR_LOGIN_PATH}#${id}`;
}

/**
 * Read the request id out of scanned QR content.
 * Accepts only `<origin>/qr-login#<id>` with a well-formed id.
 * @param content Scanned text
 * @returns The id, or undefined for anything else
 */
export function parseQrLogin(content: string): string | undefined {
  let url: URL;
  try {
    url = new URL(content.trim());
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.pathname !== QR_LOGIN_PATH) return undefined;
  if (url.search !== "" || url.username || url.password) return undefined;

  const id = url.hash.slice(1);
  return isQrLoginId(id) ? id : undefined;
}

/** Error correction of the code; low keeps it small and easy to scan */
export const QR_LEVEL = "low";

/** Result of checking scanned content against this server */
export type QrLoginCheck =
  | { kind: "ok"; id: string }
  | { kind: "foreign" }
  | { kind: "local" }
  | { kind: "invalid" };

/**
 * Like parseQrLogin, but also tells apart a well-formed code that belongs to
 * another AnyTalk server
 * @param content Scanned text
 * @param origin Origin of this app
 */
export function checkQrLogin(content: string, origin: string): QrLoginCheck {
  const id = parseQrLogin(content);
  if (!id) return { kind: "invalid" };
  const url = new URL(content.trim());
  if (url.origin === origin) return { kind: "ok", id };
  // A code made on localhost points at the other device itself, so it can't
  // be told apart from another server by address alone: give its own hint
  return LOCAL_HOSTS.has(url.hostname) &&
    !LOCAL_HOSTS.has(new URL(origin).hostname)
    ? { kind: "local" }
    : { kind: "foreign" };
}

/** Host names that only ever mean "this device" */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
