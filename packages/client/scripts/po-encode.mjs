#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * Fills the empty entries of the joke "encoded" catalogs (leet, enchantment,
 * piglatin, bottom) by encoding the English msgid mechanically. These are not
 * translations. Placeholders, plural/select syntax, tags and dayjs tokens are
 * kept intact (see po-encode-lib.ts). Entries that already have a msgstr are
 * never touched.
 *
 * Usage (from packages/client):
 *   node scripts/po-encode.mjs [locale...]   (default: all four)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ENCODERS, encodeForLocale } from "./po-encode-lib.ts";

const CATALOGS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../components/i18n/catalogs",
);

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
 * (same approach as po-untranslated.mjs so the formatting stays identical)
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

const locales = process.argv.slice(2);
if (!locales.length) locales.push(...Object.keys(ENCODERS));

for (const locale of locales) {
  if (!(locale in ENCODERS)) {
    console.error(`${locale}: not an encoded catalog`);
    process.exit(1);
  }
  const path = join(CATALOGS, locale, "messages.po");
  const blocks = parse(readFileSync(path, "utf8"));
  let filled = 0;

  for (const block of blocks) {
    if (!block.id || block.str !== "") continue;
    block.lines.splice(
      block.strStart,
      block.strEnd - block.strStart + 1,
      `msgstr ${encode(encodeForLocale(block.id, locale))}`,
    );
    filled++;
  }

  writeFileSync(path, blocks.map((b) => b.lines.join("\n")).join("\n\n"));
  console.log(`${locale}: filled ${filled}`);
}
