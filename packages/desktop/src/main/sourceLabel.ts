/** Longest label sent to viewers, in characters. */
export const LABEL_MAX_LENGTH = 64;

/** What is known about the program that owns a captured window. */
export type ProgramInfo = {
  /** Process name without `.exe` */
  name?: string;
  /** The executable's file description, e.g. "Mozilla Firefox" */
  description?: string;
  /** The executable's product name */
  product?: string;
};

/**
 * Clean a label for showing to others: control characters removed, white
 * space collapsed and the length capped.
 *
 * @param raw Any text
 * @returns The label, or undefined when nothing is left
 */
export function sanitizeLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ");
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return Array.from(clean).slice(0, LABEL_MAX_LENGTH).join("").trim();
}

/**
 * Make an executable name readable: no `.exe`, separators as spaces and a
 * capital first letter when the name is all lower case.
 *
 * @param name e.g. "firefox.exe" or "my_game"
 * @returns e.g. "Firefox" or "My game"
 */
export function presentableName(name: string): string | undefined {
  const base = name
    .replace(/\.exe$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!base) return undefined;
  const shown =
    base === base.toLowerCase()
      ? base.charAt(0).toUpperCase() + base.slice(1)
      : base;
  return sanitizeLabel(shown);
}

/**
 * Whether a description says nothing about the program: empty or a file name.
 *
 * @param text A file description or product name
 */
function isGeneric(text: string | undefined): boolean {
  if (!text?.trim()) return true;
  return /\.exe$/i.test(text.trim());
}

/**
 * Host processes that run other programs' windows. What they say about
 * themselves is not the program on screen, so they give no label.
 */
const GENERIC_HOSTS = new Set([
  "applicationframehost",
  "wwahost",
  "runtimebroker",
  "sihost",
]);

/**
 * Pick the label of a captured window: the executable's description, then
 * its product name, then the readable process name. The window title is
 * never used, it can hold private text. Generic host processes and a missing
 * lookup give no label.
 *
 * @param info What the system says about the owning program
 * @returns The label, or undefined when nothing usable is known
 */
export function chooseLabel(info: ProgramInfo | undefined): string | undefined {
  if (!info) return undefined;
  if (info.name && GENERIC_HOSTS.has(info.name.toLowerCase())) return undefined;
  if (!isGeneric(info.description)) return sanitizeLabel(info.description);
  if (!isGeneric(info.product)) return sanitizeLabel(info.product);
  return info.name ? presentableName(info.name) : undefined;
}

/**
 * Read the program info printed by the Windows lookup script.
 *
 * @param output JSON with the keys n (name), d (description), p (product)
 * @returns The info, or undefined when the output is not usable
 */
export function parseProgramInfo(output: string): ProgramInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(output.trim());
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const item = parsed as Record<string, unknown>;
    const text = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;
    return {
      name: text(item.n),
      description: text(item.d),
      product: text(item.p),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read the window class out of `xprop -id <id> WM_CLASS` output. The last
 * quoted word is the class name, e.g. "Firefox".
 *
 * @param output e.g. `WM_CLASS(STRING) = "Navigator", "firefox"`
 * @returns The class name, or undefined
 */
export function parseWmClass(output: string): string | undefined {
  const words = [...output.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  return words.length > 0 ? words[words.length - 1] || undefined : undefined;
}
