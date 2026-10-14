#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * Helper for filling in missing translations in the Lingui .po catalogs.
 *
 * Usage (from packages/client):
 *   node scripts/po-untranslated.mjs stats <locale...>
 *   node scripts/po-untranslated.mjs export <locale> [--limit N] > todo.json
 *   node scripts/po-untranslated.mjs import <locale> <translations.json> [--overwrite]
 *   node scripts/po-untranslated.mjs check <locale...>
 *
 * export prints the untranslated entries as JSON (id, notes, origins).
 * import takes a JSON object of { "<msgid>": "<translation>" } and fills in
 * only entries that are still empty. Translations whose placeholders or tags
 * don't match the source are skipped and reported. With --overwrite it also
 * replaces existing translations of the ids in the file (for corrections).
 *
 * check validates every filled entry: placeholders and tags, plural
 * categories of the locale, and leading/trailing whitespace. It exits with
 * code 1 when it finds problems.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOGS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../components/i18n/catalogs",
);

/**
 * Path to a locale's catalog
 * @param locale Locale code, e.g. "de" or "zh-Hans"
 * @returns Absolute path to messages.po
 */
function catalogPath(locale) {
  return join(CATALOGS, locale, "messages.po");
}

/**
 * Decode a quoted PO string line
 * @param line Line such as `msgid "Hello \"world\""` or `"continued"`
 * @returns Decoded text
 */
function decode(line) {
  const quoted = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
  return quoted.replace(/\\(.)/g, (_, c) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c,
  );
}

/**
 * Encode text as a PO string literal
 * @param text Text
 * @returns Quoted, escaped string
 */
function encode(text) {
  return (
    '"' +
    text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") +
    '"'
  );
}

/**
 * Parse a catalog into blocks, keeping the original lines of each block
 * @param source File contents
 * @returns Blocks with their lines, msgid, msgstr and where msgstr starts/ends
 */
function parse(source) {
  return source.split(/\n\n/).map((raw) => {
    const lines = raw.split("\n");
    const block = { lines, id: undefined, str: undefined, strStart: -1 };
    let field;
    lines.forEach((line, i) => {
      if (line.startsWith("msgid ")) {
        field = "id";
        block.id = decode(line);
      } else if (line.startsWith("msgstr ")) {
        field = "str";
        block.str = decode(line);
        block.strStart = i;
        block.strEnd = i;
      } else if (line.startsWith('"') && field) {
        block[field] += decode(line);
        if (field === "str") block.strEnd = i;
      } else {
        field = undefined;
      }
    });
    return block;
  });
}

/**
 * Untranslated entries of a parsed catalog
 * @param blocks Parsed blocks
 * @returns Blocks with a non-empty msgid and an empty msgstr
 */
function untranslated(blocks) {
  return blocks.filter((b) => b.id && b.str === "");
}

/**
 * Placeholder names and numbered tags used in a message, as a sorted key
 * @param text Message text
 * @returns String identifying the placeholders, for comparison
 */
function placeholders(text) {
  const names = [...text.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => `{${m[1]}}`);
  const tags = [...text.matchAll(/<\/?\d+\s*\/?>/g)].map((m) =>
    m[0].replace(/\s/g, ""),
  );
  return [...new Set([...names, ...tags])].sort().join(" ");
}

/**
 * Locales that Intl doesn't know, mapped to the plural rules they follow
 */
const PLURAL_FALLBACK = { tokipona: "en", owo: "en", pr: "en" };

/**
 * Plural categories a locale needs in ICU plural messages
 * @param locale Locale code
 * @returns Category names, e.g. ["one", "other"]
 */
function pluralCategories(locale) {
  const tag = PLURAL_FALLBACK[locale] ?? locale;
  try {
    return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
  } catch {
    return ["one", "other"];
  }
}

/**
 * Categories used by each `{x, plural, ...}` block of a message
 * @param text Message text
 * @returns One array of category names per plural block
 */
function pluralBlocks(text) {
  const result = [];
  for (const match of text.matchAll(/\{\s*\w+\s*,\s*plural\s*,/g)) {
    // Walk the block and collect the selectors that sit directly inside it
    const categories = [];
    let depth = 1;
    let selector = "";
    for (let i = match.index + match[0].length; i < text.length && depth; i++) {
      const char = text[i];
      if (char === "{") {
        if (depth === 1 && selector.trim()) categories.push(selector.trim());
        depth++;
        selector = "";
      } else if (char === "}") {
        depth--;
      } else if (depth === 1) {
        selector = /\s/.test(char) ? selector + " " : selector + char;
        selector = selector.trim().split(" ").pop() ?? "";
      }
    }
    result.push(categories);
  }
  return result;
}

/**
 * Problems in one translated entry
 * @param id Source text (msgid)
 * @param str Translation (msgstr)
 * @param needed Plural categories the locale needs
 * @returns Descriptions of the problems, empty when the entry is fine
 */
function problems(id, str, needed) {
  const found = [];
  if (placeholders(str) !== placeholders(id)) {
    found.push(
      `placeholders differ: ${placeholders(id)} vs ${placeholders(str)}`,
    );
  }
  const source = pluralBlocks(id);
  const target = pluralBlocks(str);
  if (source.length !== target.length) {
    found.push(
      `${source.length} plural block(s) in source, ${target.length} in translation`,
    );
  }
  target.forEach((categories) => {
    const missing = needed.filter((category) => !categories.includes(category));
    if (missing.length) found.push(`plural is missing: ${missing.join(", ")}`);
  });
  if (
    /^\s/.test(id) !== /^\s/.test(str) ||
    /\s$/.test(id) !== /\s$/.test(str)
  ) {
    found.push("leading/trailing whitespace differs");
  }
  return found;
}

const [command, locale, ...rest] = process.argv.slice(2);

if (command === "stats") {
  for (const loc of [locale, ...rest]) {
    const blocks = parse(readFileSync(catalogPath(loc), "utf8"));
    const total = blocks.filter((b) => b.id).length;
    console.log(`${loc}: ${untranslated(blocks).length} of ${total} missing`);
  }
} else if (command === "export") {
  const limitAt = rest.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(rest[limitAt + 1]) : Infinity;
  const blocks = parse(readFileSync(catalogPath(locale), "utf8"));
  const entries = untranslated(blocks)
    .slice(0, limit)
    .map((b) => ({
      id: b.id,
      notes: b.lines
        .filter((l) => l.startsWith("#.") && !l.includes("explicit-id"))
        .map((l) => l.slice(3)),
      origins: b.lines.filter((l) => l.startsWith("#:")).map((l) => l.slice(3)),
    }));
  console.log(JSON.stringify(entries, null, 2));
} else if (command === "import") {
  const path = catalogPath(locale);
  const translations = JSON.parse(readFileSync(rest[0], "utf8"));
  const overwrite = rest.includes("--overwrite");
  const blocks = parse(readFileSync(path, "utf8"));
  let filled = 0;
  const skipped = [];

  for (const block of overwrite
    ? blocks.filter((b) => b.id)
    : untranslated(blocks)) {
    const text = translations[block.id];
    if (typeof text !== "string" || !text.trim()) continue;
    if (placeholders(text) !== placeholders(block.id)) {
      skipped.push(block.id);
      continue;
    }
    block.lines.splice(
      block.strStart,
      block.strEnd - block.strStart + 1,
      `msgstr ${encode(text)}`,
    );
    filled++;
  }

  writeFileSync(path, blocks.map((b) => b.lines.join("\n")).join("\n\n"));
  console.log(`${locale}: filled ${filled}`);
  if (skipped.length) {
    console.log(`skipped ${skipped.length} (placeholders don't match):`);
    skipped.forEach((id) => console.log(`  ${JSON.stringify(id)}`));
  }
} else if (command === "check") {
  let failed = false;
  for (const loc of [locale, ...rest]) {
    const needed = pluralCategories(loc);
    const blocks = parse(readFileSync(catalogPath(loc), "utf8"));
    const issues = blocks
      .filter((b) => b.id && b.str)
      .map((b) => ({ id: b.id, found: problems(b.id, b.str, needed) }))
      .filter((issue) => issue.found.length);
    console.log(
      `${loc}: ${issues.length} problem(s) (plural: ${needed.join(", ")})`,
    );
    issues.forEach((issue) =>
      console.log(`  ${JSON.stringify(issue.id)}: ${issue.found.join("; ")}`),
    );
    if (issues.length) failed = true;
  }
  if (failed) process.exit(1);
} else {
  console.error(
    "Usage: po-untranslated.mjs stats <locale...> | export <locale> [--limit N] | import <locale> <file.json> [--overwrite] | check <locale...>",
  );
  process.exit(1);
}
