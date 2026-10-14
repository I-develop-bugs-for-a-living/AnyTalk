import { KeybindAction } from "./keybindActions";

/**
 * Sequences are a set of keys that must be pressed at the same time
 */
export const DEFAULT_SEQUENCES: Record<KeybindAction, (string | RegExp)[]> = {
  [KeybindAction.NAVIGATION_CHANNEL_UP]: ["Alt", "ArrowUp"],
  [KeybindAction.NAVIGATION_CHANNEL_DOWN]: ["Alt", "ArrowDown"],
  [KeybindAction.NAVIGATION_SERVER_UP]: ["Control", "Alt", "ArrowUp"],
  [KeybindAction.NAVIGATION_SERVER_DOWN]: ["Control", "Alt", "ArrowDown"],
  [KeybindAction.CHAT_JUMP_END]: ["Escape"],
  [KeybindAction.CHAT_MARK_SERVER_AS_READ]: ["Shift", "Escape"],
  [KeybindAction.CHAT_FOCUS_COMPOSITION]: [/^[^ ]$/],
  [KeybindAction.CHAT_REMOVE_COMPOSITION_ELEMENT]: ["Escape"],
  [KeybindAction.CHAT_CANCEL_EDITING]: ["Escape"],
  [KeybindAction.CLOSE_MODAL]: ["Escape"],
  [KeybindAction.CLOSE_FLOATING]: ["Escape"],
  [KeybindAction.CLOSE_SIDEBAR]: ["Escape"],
  [KeybindAction.VOICE_TOGGLE_MUTE]: ["Control", "Shift", "m"],
  [KeybindAction.VOICE_TOGGLE_DEAFEN]: ["Control", "Shift", "d"],
  [KeybindAction.VOICE_TOGGLE_GAME_STREAM]: ["Control", "Shift", "g"],
  [KeybindAction.TOGGLE_OVERLAY]: ["Control", "Shift", "o"],
};

/**
 * Sequences are a set of keys that must be pressed at the same time
 * (macOS version)
 */
export const DEFAULT_MAC_SEQUENCES: Record<KeybindAction, (string | RegExp)[]> =
  {
    [KeybindAction.NAVIGATION_CHANNEL_UP]: ["Alt" /* Command */, "ArrowUp"],
    [KeybindAction.NAVIGATION_CHANNEL_DOWN]: ["Alt" /* Command */, "ArrowDown"],
    [KeybindAction.NAVIGATION_SERVER_UP]: [
      "Control",
      "Alt" /* Command */,
      "ArrowUp",
    ],
    [KeybindAction.NAVIGATION_SERVER_DOWN]: [
      "Control",
      "Alt" /* Command */,
      "ArrowDown",
    ],
    [KeybindAction.CHAT_JUMP_END]: ["Escape"],
    [KeybindAction.CHAT_MARK_SERVER_AS_READ]: ["Shift", "Escape"],
    [KeybindAction.CHAT_FOCUS_COMPOSITION]: [/^[^ ]$/],
    [KeybindAction.CHAT_REMOVE_COMPOSITION_ELEMENT]: ["Escape"],
    [KeybindAction.CHAT_CANCEL_EDITING]: ["Escape"],
    [KeybindAction.CLOSE_MODAL]: ["Escape"],
    [KeybindAction.CLOSE_FLOATING]: ["Escape"],
    [KeybindAction.CLOSE_SIDEBAR]: ["Escape"],
    [KeybindAction.VOICE_TOGGLE_MUTE]: ["Control", "Shift", "m"],
    [KeybindAction.VOICE_TOGGLE_DEAFEN]: ["Control", "Shift", "d"],
    [KeybindAction.VOICE_TOGGLE_GAME_STREAM]: ["Control", "Shift", "g"],
    [KeybindAction.TOGGLE_OVERLAY]: ["Control", "Shift", "o"],
  };

/** Modifier keys, in display order */
export const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta"];

const isMac = () => navigator.platform.startsWith("Mac");

/**
 * Default keys for a keybind on this platform
 */
export function defaultSequence(action: KeybindAction) {
  return (isMac() ? DEFAULT_MAC_SEQUENCES : DEFAULT_SEQUENCES)[action];
}

/**
 * Key name used to track and store a key press. Numpad keys use their
 * `event.code` ("Numpad9") so they differ from the main row and from arrows
 while NumLock is on; letters are lower case so releasing Shift before the
 * letter (which changes event.key) can't leave the key stuck as pressed.
 * @param event Keyboard event
 */
export function keyOfEvent(event: KeyboardEvent): string {
  // with NumLock off the numpad acts as arrows, Home, PageUp...: those keep
  // their event.key so navigation hotkeys still work
  if (
    event.code.startsWith("Numpad") &&
    (event.getModifierState("NumLock") ||
      event.key.length === 1 ||
      event.key === "Enter")
  )
    return event.code;
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

/**
 * Whether a key can't be used on its own as a hotkey because it is needed
 * for navigation, typing or cancelling the recording
 * @param key Key as returned by keyOfEvent
 */
export function isReservedBareKey(key: string): boolean {
  return [
    "Escape",
    "Tab",
    "Enter",
    "Backspace",
    "Delete",
    " ",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ].includes(key);
}

/**
 * Whether a hotkey must be ignored while the user types in a text field:
 * without Ctrl, Alt or Meta its key would also produce a character. This
 * in-app rule is deliberate; global shortcuts (triggerKeybind) bypass it.
 * @param keys Keys of the hotkey
 */
export function ignoredWhileTyping(keys: (string | RegExp)[]): boolean {
  return !keys.some(
    (key) =>
      key === "Control" ||
      key === "Alt" ||
      key === "Meta" ||
      // function keys don't type anything
      (typeof key === "string" && /^F\d+$/.test(key)),
  );
}

/** Symbols shown for numpad keys that aren't digits */
const NUMPAD_NAMES: Record<string, string> = {
  Add: "+",
  Subtract: "-",
  Multiply: "*",
  Divide: "/",
  Decimal: ".",
  Enter: "Enter",
  Equal: "=",
  Comma: ",",
};

/**
 * Character a tracked key types, so pattern keybinds (like "any character
 * focuses the composer") still match numpad keys stored by their code
 * @param key Key as returned by keyOfEvent
 */
export function typedCharOf(key: string): string {
  if (!key.startsWith("Numpad")) return key;
  const rest = key.slice("Numpad".length);
  if (/^\d$/.test(rest)) return rest;
  return rest !== "Enter" && NUMPAD_NAMES[rest] ? NUMPAD_NAMES[rest] : key;
}

/**
 * Human readable name of a key
 */
export function formatKey(key: string) {
  if (key.startsWith("Numpad")) {
    const rest = key.slice("Numpad".length);
    return `Num ${NUMPAD_NAMES[rest] ?? rest}`;
  }

  switch (key) {
    case "Control":
      return "Ctrl";
    case "Meta":
      return isMac() ? "⌘" : "Super";
    case "Alt":
      return isMac() ? "⌥" : "Alt";
    case " ":
      return "Space";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/**
 * Human readable key combination, modifiers first
 */
export function formatSequence(keys: (string | RegExp)[]) {
  const names = keys.filter((key): key is string => typeof key === "string");
  return [
    ...MODIFIER_KEYS.filter((key) => names.includes(key)),
    ...names.filter((key) => !MODIFIER_KEYS.includes(key)),
  ]
    .map(formatKey)
    .join(" + ");
}
