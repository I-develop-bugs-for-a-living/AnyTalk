/**
 * Modifier keys as tracked by the keybind handler, and their Electron names
 */
const MODIFIERS: Record<string, string> = {
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Meta: "Super",
};

/**
 * Named keys as tracked by the keybind handler, and their Electron names
 */
const NAMED_KEYS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  "+": "Plus",
  ScrollLock: "Scrolllock",
};

/**
 * Numpad keys as tracked by the keybind handler (event.code), and their
 * Electron names
 */
const NUMPAD_KEYS: Record<string, string> = {
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
  NumpadEnter: "Enter",
};

/**
 * Punctuation Electron accepts as a key on its own
 */
const PUNCTUATION = new Set("-=;,./`[]\\'".split(""));

/**
 * Electron name of a single non-modifier key
 * @param key Key as tracked by the keybind handler
 * @returns Name, or null if Electron can't register this key
 */
function convertKey(key: string): string | null {
  if (key in NAMED_KEYS) return NAMED_KEYS[key];
  if (key in NUMPAD_KEYS) return NUMPAD_KEYS[key];
  if (/^Numpad\d$/.test(key)) return `num${key.slice("Numpad".length)}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return key;
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (PUNCTUATION.has(key)) return key;
  return null;
}

/**
 * Convert a keybind sequence to an Electron accelerator string
 * (e.g. ["Control", "Shift", "m"] becomes "Ctrl+Shift+M")
 * @param keys Keys held together
 * @returns Accelerator, or null if the sequence can't be a global hotkey:
 * it has a RegExp entry, an unknown key, or not exactly one non-modifier key
 */
export function sequenceToAccelerator(
  keys: (string | RegExp)[],
): string | null {
  const modifiers = new Set<string>();
  const others: string[] = [];

  for (const key of keys) {
    if (typeof key !== "string") return null;
    if (key in MODIFIERS) modifiers.add(MODIFIERS[key]);
    else others.push(key);
  }

  if (others.length !== 1) return null;

  const main = convertKey(others[0]);
  if (!main) return null;

  // modifiers in a stable order, whatever order they were pressed in
  const ordered = Object.values(MODIFIERS).filter((name) =>
    modifiers.has(name),
  );

  return [...ordered, main].join("+");
}

/**
 * Keys that can be registered system-wide without a modifier: they don't
 * type anything, so they don't steal normal typing (numpad Enter is left
 * out, it would take over Enter everywhere)
 */
function isSafeBareAccelerator(accelerator: string): boolean {
  return (
    /^F\d+$/.test(accelerator) ||
    /^num(\d|add|sub|mult|div|dec)$/.test(accelerator) ||
    ["Insert", "Home", "End", "PageUp", "PageDown", "Scrolllock"].includes(
      accelerator,
    )
  );
}

/**
 * Convert a keybind sequence to an accelerator that is safe to register
 * system-wide: a bare letter or digit would steal normal typing everywhere,
 * so it needs at least one modifier, unless it is a function, numpad or
 * navigation key
 * @param keys Keys held together
 * @returns Accelerator, or null if it can't be a global hotkey
 */
export function sequenceToGlobalAccelerator(
  keys: (string | RegExp)[],
): string | null {
  const accelerator = sequenceToAccelerator(keys);
  if (!accelerator) return null;

  const hasModifier = keys.some(
    (key) => typeof key === "string" && key in MODIFIERS,
  );

  return hasModifier || isSafeBareAccelerator(accelerator) ? accelerator : null;
}
