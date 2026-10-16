/**
 * Pure logic for the low-level keyboard hook: parsing the accelerator strings
 * the client sends and matching key events against them. It imports nothing,
 * the uiohook key table is passed in, so `node --test` can run it.
 */

/** Table of key name to uiohook keycode, shaped like `UiohookKey`. */
export type KeyTable = Readonly<Record<string, number>>;

/** Modifier flags of a binding. */
export type ModifierSet = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};

/** An accelerator broken down into modifiers and the one main key. */
export type ParsedAccelerator = {
  modifiers: ModifierSet;
  /** uiohook keycodes the main key can have (Enter has two) */
  keycodes: number[];
};

/** Which edge of a key press an action fires on. */
export type HotkeyEdge = "down" | "up";

/** Electron names of keys that map to a differently named `UiohookKey`. */
const NAMED: Record<string, string> = {
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  plus: "Equal",
  scrolllock: "ScrollLock",
  numadd: "NumpadAdd",
  numsub: "NumpadSubtract",
  nummult: "NumpadMultiply",
  numdiv: "NumpadDivide",
  numdec: "NumpadDecimal",
};

/** Punctuation characters and their `UiohookKey` names. */
const PUNCTUATION: Record<string, string> = {
  "-": "Minus",
  "=": "Equal",
  ";": "Semicolon",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "'": "Quote",
};

/**
 * Look up the `UiohookKey` name for the main key of an accelerator.
 *
 * @param key Key part of the accelerator, e.g. "M", "F5", "numadd"
 * @returns Name in the key table, or undefined if unsupported
 */
function keyName(key: string): string | undefined {
  const lower = key.toLowerCase();
  if (lower in NAMED) return NAMED[lower];
  if (key in PUNCTUATION) return PUNCTUATION[key];
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^f([1-9]|1\d|2[0-4])$/i.test(key)) return key.toUpperCase();
  const num = /^num([0-9])$/i.exec(key);
  if (num) return `Numpad${num[1]}`;
  return undefined;
}

/**
 * Keycode for a `KeyboardEvent.code` such as "KeyZ", "Digit1" or "Numpad0".
 * Most names match `UiohookKey` directly, only letters and digits differ.
 *
 * @param code Value of `KeyboardEvent.code`
 * @param keys uiohook key table
 * @returns Keycode, or undefined if the table has no such key
 */
function codeKeycode(code: string, keys: KeyTable): number | undefined {
  const letter = /^Key([A-Z])$/.exec(code);
  const digit = /^Digit([0-9])$/.exec(code);
  const name = letter ? letter[1] : digit ? digit[1] : code;
  const keycode = keys[name];
  return typeof keycode === "number" ? keycode : undefined;
}

/**
 * Parse an Electron accelerator (`[Ctrl+][Alt+][Shift+][Super+]Key`).
 *
 * @param accelerator Accelerator string from the client
 * @param keys uiohook key table (`UiohookKey`)
 * @param code `KeyboardEvent.code` of the main key. When it names a key the
 * table knows, it decides the main key, so layouts that differ from US
 * (QWERTZ, AZERTY) hit the key the user pressed. Modifiers always come from
 * the accelerator.
 * @returns Modifiers and keycodes, or null if it can't be matched by the hook
 */
export function parseAccelerator(
  accelerator: string,
  keys: KeyTable,
  code?: string,
): ParsedAccelerator | null {
  // "Plus" is spelled out, so a literal "+" only appears as the separator
  const parts = accelerator.split("+");
  const main = parts.pop();
  if (!main) return null;

  const modifiers: ModifierSet = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "ctrl":
      case "control":
      case "commandorcontrol":
      case "cmdorctrl":
        modifiers.ctrl = true;
        break;
      case "alt":
      case "option":
        modifiers.alt = true;
        break;
      case "shift":
        modifiers.shift = true;
        break;
      case "super":
      case "meta":
      case "cmd":
      case "command":
        modifiers.meta = true;
        break;
      default:
        return null;
    }
  }

  const fromCode = code === undefined ? undefined : codeKeycode(code, keys);
  if (fromCode !== undefined) return { modifiers, keycodes: [fromCode] };

  const name = keyName(main);
  const keycode = name === undefined ? undefined : keys[name];
  if (typeof keycode !== "number") return null;
  // Plain "Enter" is both Enters in Electron
  const keycodes = [keycode];
  if (name === "Enter" && typeof keys.NumpadEnter === "number")
    keycodes.push(keys.NumpadEnter);
  return { modifiers, keycodes };
}

/** One action bound to a parsed accelerator. */
export type MatcherBinding = { action: string; parsed: ParsedAccelerator };

/** Matcher fed with key events, see `createHotkeyMatcher`. */
export type HotkeyMatcher = {
  /** Replace the bindings. Held actions that no longer match are released. */
  setBindings(bindings: MatcherBinding[]): void;
  /** A key went down (repeats of a held key are ignored). */
  keyDown(keycode: number, modifiers: ModifierSet): void;
  /** A key went up. */
  keyUp(keycode: number, modifiers: ModifierSet): void;
  /** Emit `up` for every active action and forget held keys. */
  releaseAll(): void;
};

/**
 * Create the state machine behind the hotkey hook. An action fires `down`
 * once when its main key goes down while exactly its modifiers are held (left
 * and right variants both count), and `up` when the main key or a required
 * modifier is released.
 *
 * Modifier state comes from the flags on each event, not from tracked
 * key-ups, so a missed modifier release (Win+L, secure desktop) can't leave
 * a modifier stuck.
 *
 * @param emit Called with the action and the edge
 */
export function createHotkeyMatcher(
  emit: (action: string, edge: HotkeyEdge) => void,
): HotkeyMatcher {
  let bindings: MatcherBinding[] = [];
  /** Non-modifier keys currently held */
  const held = new Set<number>();
  /** Actions that fired `down` and are waiting for `up` */
  const active = new Set<string>();
  /** Modifiers as of the latest event */
  let current: ModifierSet = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };

  /** Whether the binding's main key is held. */
  const mainHeld = (parsed: ParsedAccelerator) =>
    parsed.keycodes.some((code) => held.has(code));

  /** Whether the held modifiers are exactly the binding's. */
  const modifiersMatch = (m: ModifierSet) =>
    m.ctrl === current.ctrl &&
    m.alt === current.alt &&
    m.shift === current.shift &&
    m.meta === current.meta;

  /** Whether every modifier the binding needs is still held. */
  const modifiersHeld = (m: ModifierSet) =>
    (!m.ctrl || current.ctrl) &&
    (!m.alt || current.alt) &&
    (!m.shift || current.shift) &&
    (!m.meta || current.meta);

  /** Emit `up` for active actions whose keys are no longer held. */
  const releaseStale = () => {
    for (const { action, parsed } of bindings) {
      if (!active.has(action)) continue;
      if (mainHeld(parsed) && modifiersHeld(parsed.modifiers)) continue;
      active.delete(action);
      emit(action, "up");
    }
  };

  return {
    setBindings(next) {
      bindings = next;
      // Actions that were removed can't see an `up` anymore
      const wanted = new Set(next.map((b) => b.action));
      for (const action of [...active]) {
        if (wanted.has(action)) continue;
        active.delete(action);
        emit(action, "up");
      }
      releaseStale();
    },
    keyDown(keycode, modifiers) {
      current = modifiers;
      // Auto-repeat sends more key-downs without a key-up in between
      if (held.has(keycode)) return;
      held.add(keycode);
      for (const { action, parsed } of bindings) {
        if (!parsed.keycodes.includes(keycode) || active.has(action)) continue;
        if (!modifiersMatch(parsed.modifiers)) continue;
        active.add(action);
        emit(action, "down");
      }
    },
    keyUp(keycode, modifiers) {
      current = modifiers;
      held.delete(keycode);
      releaseStale();
    },
    releaseAll() {
      held.clear();
      for (const action of [...active]) {
        active.delete(action);
        emit(action, "up");
      }
    },
  };
}
