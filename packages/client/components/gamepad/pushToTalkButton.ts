import { createSignal } from "solid-js";

/** Controller buttons that can be the push to talk button, by name */
export const PTT_BUTTONS = [
  "a",
  "b",
  "x",
  "y",
  "lb",
  "rb",
  "lt",
  "rt",
  "select",
  "start",
  "l3",
  "r3",
  "up",
  "down",
  "left",
  "right",
] as const;

/** Name of a controller button that can be the push to talk button */
export type PttButton = (typeof PTT_BUTTONS)[number];

/**
 * The saved push to talk button, if it is a known one
 * @param value Saved setting
 * @returns Button, or null for none or an unknown value
 */
export function parsePttButton(value: unknown): PttButton | null {
  return (PTT_BUTTONS as readonly unknown[]).includes(value)
    ? (value as PttButton)
    : null;
}

const [gamepadPushToTalkAvailable, setGamepadPushToTalkAvailable] =
  createSignal<boolean>();

/**
 * Whether the desktop shell accepted the controller push to talk button:
 * undefined while unknown or when no button is set, false when the shell
 * can't read controllers
 */
export { gamepadPushToTalkAvailable, setGamepadPushToTalkAvailable };
