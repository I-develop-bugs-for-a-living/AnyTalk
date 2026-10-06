/**
 * Lowercase a string and strip accents so searches ignore case and diacritics
 * @param text Text to normalise
 * @returns Normalised text
 */
export function normaliseSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

/** Intl.DisplayNames per display language, built once */
const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

/** Normalised names per display language and code, built once */
const nameCache = new Map<string, string | undefined>();

/**
 * Look up the name of a language code in a given display language
 * @param code Language code (e.g. `de`, `es-419`)
 * @param inLocale Language to write the name in
 * @returns The name, or undefined when the code is unknown to Intl
 */
function displayNameOf(code: string, inLocale: string): string | undefined {
  const key = `${inLocale}|${code}`;
  if (nameCache.has(key)) return nameCache.get(key);

  let result: string | undefined;
  try {
    let names = displayNamesCache.get(inLocale);
    if (names === undefined) {
      try {
        names = new Intl.DisplayNames([inLocale], { type: "language" });
      } catch {
        names = null;
      }
      displayNamesCache.set(inLocale, names);
    }

    const name = names?.of(code.replace(/_/g, "-"));
    // Intl echoes the code back when it doesn't know it
    result = name && name !== code ? name : undefined;
  } catch {
    // unknown or invalid codes (tokipona, owo, dev, ...)
    result = undefined;
  }

  nameCache.set(key, result);
  return result;
}

/**
 * Number of cached display-name lookups (for tests)
 * @returns Entry count
 */
export function displayNameCacheSize(): number {
  return nameCache.size;
}

/**
 * Check whether a language matches a search query
 *
 * Matches the native display name, the locale code, the English name and
 * the name in the current UI language, ignoring case and accents.
 * @param query What the user typed
 * @param code Language code
 * @param nativeName Display name of the language in itself
 * @param uiLocale Current UI language code
 * @returns Whether the language should be listed
 */
export function languageMatchesQuery(
  query: string,
  code: string,
  nativeName: string,
  uiLocale: string,
): boolean {
  const needle = normaliseSearch(query);
  if (!needle) return true;

  const haystack = [
    nativeName,
    code,
    displayNameOf(code, "en"),
    displayNameOf(code, uiLocale),
  ];

  return haystack.some(
    (entry) => entry !== undefined && normaliseSearch(entry).includes(needle),
  );
}
