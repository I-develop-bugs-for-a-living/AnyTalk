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

/** Longest window title used as a label for Java programs, in characters. */
export const JAVA_TITLE_MAX_LENGTH = 48;

/**
 * Whether the program is a Java runtime. Java games all report the runtime
 * ("OpenJDK Platform binary") instead of their own name, so the program says
 * nothing about what is on screen.
 *
 * @param info What the system says about the owning program
 */
export function isJavaProgram(info: ProgramInfo): boolean {
  const name = info.name
    ?.trim()
    .replace(/\.exe$/i, "")
    .toLowerCase();
  if (name === "java" || name === "javaw" || name === "javaws") return true;
  // Linux window classes of Java GUI toolkits
  if (name?.startsWith("sun-awt") || name?.startsWith("java-")) return true;
  // runtime descriptions: "OpenJDK Platform binary", "Java(TM) Platform SE
  // binary", "Eclipse Temurin ..." (must name Java, so no other program
  // ever gets its window title shown)
  const description = info.description ?? "";
  return (
    /platform( se)? binary/i.test(description) &&
    /java|openjdk|temurin|zulu|jdk|jre/i.test(description)
  );
}

/**
 * Turn a window title into a short label: control characters removed, white
 * space collapsed, cut to `JAVA_TITLE_MAX_LENGTH` with an ellipsis.
 *
 * @param title The window title
 * @returns The label, or undefined when the title is empty
 */
function titleLabel(title: string | undefined): string | undefined {
  if (typeof title !== "string") return undefined;
  // cleaned without sanitizeLabel's own (longer) cap, so the cut is ours
  const clean = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return undefined;
  const chars = Array.from(clean);
  if (chars.length <= JAVA_TITLE_MAX_LENGTH) return clean;
  return (
    chars
      .slice(0, JAVA_TITLE_MAX_LENGTH - 1)
      .join("")
      .trimEnd() + "\u2026"
  );
}

/**
 * Pick the label of a captured window: the executable's description, then
 * its product name, then the readable process name. The window title is
 * not used, it can hold private text. The one exception is Java runtimes,
 * which have no useful name of their own: they get the window title (the
 * game's name, usually), or "Java" when the title is empty. Generic host
 * processes and a missing lookup give no label.
 *
 * @param info What the system says about the owning program
 * @param title The window title, only used for Java programs
 * @returns The label, or undefined when nothing usable is known
 */
export function chooseLabel(
  info: ProgramInfo | undefined,
  title?: string,
): string | undefined {
  if (!info) return undefined;
  if (info.name && GENERIC_HOSTS.has(info.name.toLowerCase())) return undefined;
  if (isJavaProgram(info)) return titleLabel(title) ?? "Java";
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

/**
 * Encode a PowerShell script for `-EncodedCommand` (base64 of UTF-16LE), so
 * no quoting survives the command line.
 *
 * @param script The script text
 */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Split one line of CSV with quoted fields (`"a","b,c"`, `""` is a quote).
 *
 * @param line One line without the line break
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields;
}

/**
 * Find the process that owns a window from `tasklist /v /fo csv /nh` output,
 * by the exact window title. Used when PowerShell gave nothing. Several
 * different programs with the same title are ambiguous and give nothing.
 *
 * @param output The tasklist output (the title is the last column)
 * @param title The window title (`desktopCapturer` source name)
 * @returns The process name, or undefined
 */
export function processNameByTitle(
  output: string,
  title: string,
): string | undefined {
  const wanted = title.trim();
  if (!wanted) return undefined;
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const fields = splitCsvLine(line);
    if (fields.length < 9 || !fields[0]) continue;
    if (fields[fields.length - 1].trim() === wanted) names.add(fields[0]);
  }
  return names.size === 1 ? [...names][0] : undefined;
}
