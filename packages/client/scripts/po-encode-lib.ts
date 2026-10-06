/**
 * Pure encoders behind scripts/po-encode.mjs, which fills the joke "encoded"
 * catalogs (leet, enchantment, piglatin, bottom) from the English source text.
 *
 * Only erasable TypeScript syntax is used here so Node can import this file
 * directly (the script runs without a build step) and vitest can test it.
 */

/** A function that encodes a run of plain human text */
export type Encoder = (text: string) => string;

/** Names of the encoded catalogs this module can produce */
export type EncodedLocale = "leet" | "enchantment" | "piglatin" | "bottom";

/** Leetspeak substitutions (output is uppercase, other letters are kept) */
const LEET: Record<string, string> = {
  A: "4",
  B: "8",
  E: "3",
  G: "6",
  I: "1",
  O: "0",
  R: "2",
  S: "5",
  T: "7",
};

/** Standard Galactic Alphabet, a to z */
const ENCHANTMENT: Record<string, string> = {
  a: "ᔑ",
  b: "ʖ",
  c: "ᓵ",
  d: "↸",
  e: "ᒷ",
  f: "⎓",
  g: "⊣",
  h: "⍑",
  i: "╎",
  j: "⋮",
  k: "ꖌ",
  l: "ꖎ",
  m: "ᒲ",
  n: "リ",
  o: "𝙹",
  p: "!¡",
  q: "ᑑ",
  r: "∷",
  s: "ᓭ",
  t: "ℸ",
  u: "⚍",
  v: "⍊",
  w: "∴",
  x: "/",
  y: "||",
  z: "⨅",
};

/**
 * Leetspeak encoding
 * @param text Plain text
 * @returns Uppercase text with letters swapped for look-alike digits
 */
export function encodeLeet(text: string): string {
  return text
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => LEET[letter] ?? letter);
}

/**
 * Standard Galactic Alphabet ("enchanting table") encoding
 * @param text Plain text
 * @returns Text with a-z (any case) mapped to galactic glyphs
 */
export function encodeEnchantment(text: string): string {
  return text.replace(/[a-z]/gi, (letter) => ENCHANTMENT[letter.toLowerCase()]);
}

/**
 * Pig latin encoding of a single word
 * @param word Word made of letters and optional inner apostrophes
 * @returns Pig latin word, keeping the original capitalisation style
 */
function pigLatinWord(word: string): string {
  const isUpper = word.length > 1 && word === word.toUpperCase();
  const isCapitalised = /^[A-Z]/.test(word);

  // Leave mixed-case words (LiveKit, iPhone) alone
  if (!isUpper && /[A-Z]/.test(word.slice(1))) return word;

  // Leading consonant cluster ("qu" belongs to it, a leading "y" counts as a
  // consonant); words starting with a vowel just get "yay"
  const cluster =
    /^(?:[bcdfghjklmnpqrstvwxz]*qu|[bcdfghjklmnpqrstvwxz]+|y)/i.exec(word)?.[0];
  if (!cluster) return word + (isUpper ? "YAY" : "yay");

  const result = word.slice(cluster.length) + cluster + "ay";
  if (isUpper) return result.toUpperCase();
  if (isCapitalised)
    return result[0].toUpperCase() + result.slice(1).toLowerCase();
  return result.toLowerCase();
}

/**
 * Pig latin encoding
 * @param text Plain text
 * @returns Text where each alphabetic word is converted, rest is kept
 */
export function encodePigLatin(text: string): string {
  return text.replace(/[A-Za-z]+(?:'[A-Za-z]+)*/g, (word, offset: number) => {
    // Skip words glued to digits (18th, 2fa) so numbers stay readable
    const before = text[offset - 1];
    const after = text[offset + word.length];
    if (/\d/.test(before ?? "") || /\d/.test(after ?? "")) return word;
    return pigLatinWord(word);
  });
}

/**
 * Bottom encoding (https://github.com/bottom-software-foundation/spec)
 * @param text Plain text
 * @returns Each UTF-8 byte as emoji digits (200, 50, 10, 5, 1, 0) plus a
 * trailing finger-pointing pair
 */
export function encodeBottom(text: string): string {
  const units: [number, string][] = [
    [200, "🫂"],
    [50, "💖"],
    [10, "✨"],
    [5, "🥺"],
    [1, ","],
  ];
  let out = "";
  for (let byte of new TextEncoder().encode(text)) {
    if (byte === 0) out += "❤️";
    for (const [value, symbol] of units) {
      while (byte >= value) {
        out += symbol;
        byte -= value;
      }
    }
    out += "👉👈";
  }
  return out;
}

/** Encoders by catalog locale */
export const ENCODERS: Record<EncodedLocale, Encoder> = {
  leet: encodeLeet,
  enchantment: encodeEnchantment,
  piglatin: encodePigLatin,
  bottom: encodeBottom,
};

/**
 * Find the end of a balanced `{...}` group
 * @param text Message
 * @param start Index of the opening brace
 * @returns Index of the matching closing brace, or -1 when unbalanced
 */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Encode the branches of a plural/select body, e.g. ` one {# a} other {# b}`
 * @param body Text after `{0, plural,` up to (not including) the final `}`
 * @param encode Text encoder
 * @returns Body with keywords and braces kept and branch text encoded
 */
function encodeBranches(body: string, encode: Encoder): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open === -1) return out + body.slice(i);
    const close = matchingBrace(body, open);
    if (close === -1) return out + body.slice(i);
    // Keyword (one, other, =0, offset:1, ...) stays as it is
    out += body.slice(i, open + 1);
    out += encodeMessage(body.slice(open + 1, close), encode);
    out += "}";
    i = close + 1;
  }
  return out;
}

/**
 * Encode an ICU message, keeping placeholders, plural/select syntax, `#` and
 * numbered tags intact and encoding only the human text around them
 * @param message ICU message text
 * @param encode Encoder for runs of plain text
 * @returns Encoded message
 */
export function encodeMessage(message: string, encode: Encoder): string {
  let out = "";
  let text = "";
  const flush = () => {
    if (text) out += encode(text);
    text = "";
  };

  for (let i = 0; i < message.length; ) {
    const char = message[i];

    if (char === "{") {
      const close = matchingBrace(message, i);
      if (close === -1) {
        text += message.slice(i);
        break;
      }
      flush();
      const inner = message.slice(i + 1, close);
      const header = /^\s*\w+\s*,\s*(?:plural|selectordinal|select)\s*,/.exec(
        inner,
      );
      out += header
        ? "{" +
          header[0] +
          encodeBranches(inner.slice(header[0].length), encode) +
          "}"
        : message.slice(i, close + 1);
      i = close + 1;
      continue;
    }

    const tag = /^<\/?\w+\s*\/?>/.exec(message.slice(i, i + 40));
    if (tag) {
      flush();
      out += tag[0];
      i += tag[0].length;
      continue;
    }

    // `#` (plural count) and line breaks are kept as they are
    if (char === "#" || char === "\n") {
      flush();
      out += char;
      i++;
      continue;
    }

    text += char;
    i++;
  }
  flush();
  return out;
}

/**
 * Whether a message is a dayjs format id such as `[Yesterday at] LT`
 * @param message Message id
 * @returns True when it contains dayjs tokens next to bracketed text
 */
function isDayjsFormat(message: string): boolean {
  return /\[[^\]]*\]/.test(message) && /\bLT\b|dddd/.test(message);
}

/**
 * Encode a catalog message for one of the joke locales
 * @param message English msgid
 * @param locale Target catalog locale
 * @returns Encoded text, with placeholders and syntax intact
 */
export function encodeForLocale(
  message: string,
  locale: EncodedLocale,
): string {
  const encode = ENCODERS[locale];
  if (isDayjsFormat(message)) {
    // Only the text inside [...] is shown; tokens like LT and dddd stay
    return message.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
      return "[" + encode(inner) + "]";
    });
  }
  return encodeMessage(message, encode);
}
