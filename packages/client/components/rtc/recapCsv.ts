import { Direction } from "./stats";

/**
 * Reading recap CSV exports back in, to compare them with other recaps
 */

export type RecapKind = "call" | "stream";

/** One sample: milliseconds since the start plus numeric metrics */
export type RecapRow = { t: number } & Record<string, number | undefined>;

/** One line of samples, e.g. a microphone or a stream */
export interface RecapLine {
  label: string;
  direction?: Direction;
  rows: RecapRow[];
}

export interface ParsedRecap {
  kind: RecapKind;
  lines: RecapLine[];
}

/** Columns only present on streams we sent / watched */
const STREAM_SENDING = ["targetBitrate", "activeLayers"];
const STREAM_RECEIVING = ["dropped", "frozen", "jitterBuffer", "jitter"];

/**
 * Split one CSV line, keeping commas inside quoted fields. Participant names
 * are written with JSON.stringify, so quoted fields are read as JSON first
 * and as standard CSV ("" for a quote) otherwise.
 * @param line Line
 * @returns Fields
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") j += 2;
        else if (line[j] === '"' && line[j + 1] === '"') j += 2;
        else if (line[j] === '"') break;
        else j++;
      }

      const raw = line.slice(i, j + 1);
      let value: string;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw.slice(1, -1).replace(/""/g, '"');
      }

      fields.push(value);
      i = line.indexOf(",", j + 1);
      if (i === -1) break;
      i++;
    } else {
      const end = line.indexOf(",", i);
      fields.push(line.slice(i, end === -1 ? undefined : end));
      if (end === -1) break;
      i = end + 1;
    }
  }

  return fields;
}

/**
 * Parse a call or stream recap CSV as downloaded from the recap pages
 * @param text File contents
 * @returns Recap lines, or an error message
 */
export function parseRecapCsv(text: string): ParsedRecap | { error: string } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return { error: "The file has no samples." };

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const secondsCol = header.indexOf("seconds");
  if (secondsCol === -1) {
    return { error: "Not a recap CSV: there is no seconds column." };
  }

  const participantCol = header.indexOf("participant");
  const directionCol = header.indexOf("direction");
  const kind: RecapKind =
    participantCol !== -1 && directionCol !== -1 ? "call" : "stream";

  const metricCols = header
    .map((name, i) => ({ name, i }))
    .filter(
      ({ i }) => i !== secondsCol && i !== participantCol && i !== directionCol,
    );

  const byLine = new Map<string, RecapLine>();

  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    const seconds = Number(fields[secondsCol]);
    if (!Number.isFinite(seconds)) continue;

    const direction =
      kind === "call" && fields[directionCol] === "sending"
        ? "sending"
        : kind === "call"
          ? "receiving"
          : undefined;
    const name = kind === "call" ? fields[participantCol] || "Unknown" : "";
    const key = `${name}\u0000${direction ?? ""}`;

    let entry = byLine.get(key);
    if (!entry) {
      entry = {
        label:
          kind === "call"
            ? direction === "sending"
              ? `${name}'s microphone`
              : `${name} heard`
            : "Stream",
        direction,
        rows: [],
      };
      byLine.set(key, entry);
    }

    const row: RecapRow = { t: seconds * 1000 };
    for (const { name, i } of metricCols) {
      const value = fields[i]?.trim();
      // text columns such as the quality limitation reason aren't charted
      if (value && Number.isFinite(Number(value))) row[name] = Number(value);
    }
    entry.rows.push(row);
  }

  if (!byLine.size) return { error: "The file has no samples." };

  const out = [...byLine.values()];
  for (const line of out) line.rows.sort((a, b) => a.t - b.t);

  // stream exports don't say which way the stream went, tell by its columns
  if (kind === "stream") {
    const has = (cols: string[]) =>
      out[0].rows.some((r) => cols.some((c) => r[c] !== undefined));
    const direction: Direction | undefined = has(STREAM_SENDING)
      ? "sending"
      : has(STREAM_RECEIVING)
        ? "receiving"
        : undefined;
    out[0].direction = direction;
    out[0].label =
      direction === "sending"
        ? "Sent stream"
        : direction === "receiving"
          ? "Watched stream"
          : "Stream";
  }

  return { kind, lines: out };
}
