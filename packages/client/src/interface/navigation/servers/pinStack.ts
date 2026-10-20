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
