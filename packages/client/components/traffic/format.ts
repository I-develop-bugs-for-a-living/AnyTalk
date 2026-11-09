/** Names of the TLS and DTLS version codes WebRTC stats report. */
const VERSION_NAMES: Record<string, string> = {
  FEFF: "DTLS 1.0",
  FEFD: "DTLS 1.2",
  FEFC: "DTLS 1.3",
  "0301": "TLS 1.0",
  "0302": "TLS 1.1",
  "0303": "TLS 1.2",
  "0304": "TLS 1.3",
};

/**
 * Turn the raw `tlsVersion` of a WebRTC transport ("FEFD") into a name
 * ("DTLS 1.2"). Unknown codes are returned as they are.
 *
 * @param raw The code from the stats report
 */
export function tlsVersionName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const code = raw.trim().replace(/^0x/i, "").toUpperCase();
  return VERSION_NAMES[code] ?? raw;
}

/**
 * Short, human readable size ("1.4 kB"). Returns an empty string when the
 * size is unknown.
 *
 * @param bytes Size in bytes
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1000;
    unit++;
  } while (value >= 1000 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Short duration ("120 ms", "2.4 s"). Empty when unknown.
 *
 * @param ms Duration in milliseconds
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * File name stamp of a moment: `2026-10-27_14-03-09`, in local time.
 *
 * @param date The moment
 */
export function fileStamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  );
}

/**
 * Clock time with milliseconds in local time: `14:03:09.512`.
 *
 * @param ms Epoch milliseconds
 */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
