/**
 * Keys that sit at the same physical place on every layout, by the name the
 * keybind handler tracks them under, and their `KeyboardEvent.code`
 */
const FIXED_CODES: Record<string, string> = {
  " ": "Space",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Escape: "Escape",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ScrollLock: "ScrollLock",
};

/**
 * Map from a typed character to the `KeyboardEvent.code` that types it, built
 * from the keyboard layout map (code to unshifted character)
 * @param layout Layout map, as from `navigator.keyboard.getLayoutMap()`
 * @returns Map; a character typed by several keys maps to null (ambiguous)
 */
export function invertLayout(
  layout: ReadonlyMap<string, string>,
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const [code, char] of layout) {
    const key = char.toLowerCase();
    result.set(key, result.has(key) ? null : code);
  }
  return result;
}

/**
 * The `KeyboardEvent.code` of the main key of a stored keybind
 * @param key Key as tracked by the keybind handler
 * @param inverted Inverted layout map, or undefined if not known
 * @returns Code, or undefined if it can't be told reliably
 */
export function codeOfKey(
  key: string,
  inverted?: ReadonlyMap<string, string | null>,
): string | undefined {
  if (key in FIXED_CODES) return FIXED_CODES[key];
  if (/^Numpad/.test(key)) return key;
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return key;
  return inverted?.get(key.toLowerCase()) ?? undefined;
}
