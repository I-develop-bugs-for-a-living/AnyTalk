/**
 * Number of pinned chats from which the rail shows one collapsible stack
 * instead of a shortcut per chat
 */
export const PIN_STACK_THRESHOLD = 3;

/**
 * Whether this many pinned chats are shown as a stack
 * @param count Number of pinned chats
 */
export function shouldStackPins(count: number): boolean {
  return count >= PIN_STACK_THRESHOLD;
}

/**
 * Summarise the badges of a collapsed pin stack
 * @param chats Pinned chats with their unread state and mention count
 * @returns Summed mentions, and whether any chat is unread
 */
export function aggregatePinBadges(
  chats: { unread: boolean; mentions: number }[],
): { mentions: number; unread: boolean } {
  return {
    mentions: chats.reduce((sum, chat) => sum + chat.mentions, 0),
    unread: chats.some((chat) => chat.unread),
  };
}

/**
 * Number of slots in the collapsed stack's 2x2 preview grid
 */
export const PIN_PREVIEW_SLOTS = 4;

/**
 * Split pinned chats into the avatars shown in the collapsed preview and the
 * number left over for a "+N" counter, which takes the last slot
 * @param chats Pinned chats, in rail order
 * @returns Chats to show as avatars, and how many are hidden (0 if none)
 */
export function splitPinPreview<T>(chats: T[]): {
  shown: T[];
  hidden: number;
} {
  if (chats.length <= PIN_PREVIEW_SLOTS) return { shown: chats, hidden: 0 };
  const shown = chats.slice(0, PIN_PREVIEW_SLOTS - 1);
  return { shown, hidden: chats.length - shown.length };
}
