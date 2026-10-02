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
 * Human readable name of a key
 */
export function formatKey(key: string) {
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
