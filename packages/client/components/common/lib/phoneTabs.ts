/**
 * Pure logic of the phone bottom navigation bar: the tabs, the badge counts
 * and which tab a route belongs to.
 */

/**
 * Tabs of the bottom navigation bar, in display order
 */
export const PHONE_TABS = [
  "home",
  "messages",
  "servers",
  "inbox",
  "you",
] as const;

/**
 * One tab of the bottom navigation bar
 */
export type PhoneTab = (typeof PHONE_TABS)[number];

/**
 * Tab shown when nothing was chosen yet
 */
export const DEFAULT_PHONE_TAB: PhoneTab = "home";

/**
 * Check a stored value
 * @param value Anything read from storage
 * @returns Whether it names a tab
 */
export function isPhoneTab(value: unknown): value is PhoneTab {
  return PHONE_TABS.includes(value as PhoneTab);
}

/**
 * Number of people waiting for an answer to their friend request
 * @param users Collection of users (anything with `filter`)
 * @returns Count of incoming requests
 */
export function countIncomingRequests(users: {
  filter: (predicate: (user: { relationship: string }) => boolean) => {
    length: number;
  };
}): number {
  return users.filter((user) => user.relationship === "Incoming").length;
}

/**
 * What the badge logic needs to know about a conversation
 */
export interface ConversationSnapshot {
  unread: boolean;
  muted: boolean;
}

/**
 * Number of unread, unmuted conversations
 * @param conversations Direct messages and groups
 * @returns Count shown on the Messages tab
 */
export function countUnreadConversations(
  conversations: Iterable<ConversationSnapshot>,
): number {
  let count = 0;
  for (const conversation of conversations) {
    if (conversation.unread && !conversation.muted) count++;
  }
  return count;
}

/**
 * What the badge logic needs to know about a server
 */
export interface ServerSnapshot {
  unread: boolean;
  muted: boolean;
  /** Number of unread mentions */
  mentions: number;
}

/**
 * Badge of the Servers tab: a number for mentions, else a dot for unreads
 */
export interface ServerBadge {
  mentions: number;
  dot: boolean;
}

/**
 * Summarise the servers for the Servers tab. Muted servers count for nothing.
 * @param servers Servers the user is in
 * @returns Mention total, and whether to show a plain unread dot
 */
export function summarizeServers(
  servers: Iterable<ServerSnapshot>,
): ServerBadge {
  let mentions = 0;
  let dot = false;
  for (const server of servers) {
    if (server.muted) continue;
    mentions += server.mentions;
    if (server.unread) dot = true;
  }
  return { mentions, dot: mentions === 0 && dot };
}

/**
 * Text for a count inside a badge, capped so it always fits
 * @param count Number to show
 * @returns "99+" for 100 and more
 */
export function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/**
 * Where the current route points to
 */
export interface RouteInfo {
  /** Path without the instance prefix, e.g. "/app" */
  path: string;
  serverId?: string;
  channelId?: string;
  /** Type of the open channel, if it is known */
  channelType?: string;
}

/**
 * Tab a route belongs to, so "back" from a chat lands on the right list.
 * Pages that can be opened from several tabs (Friends, server overview,
 * Discover) belong to none and leave the tab as it is.
 * @param route Current route
 * @returns The tab, or undefined to keep the current one
 */
export function tabForRoute(route: RouteInfo): PhoneTab | undefined {
  if (route.path === "/app") return "home";
  if (route.serverId) return "servers";
  if (route.channelId) {
    if (
      route.channelType === "DirectMessage" ||
      route.channelType === "Group" ||
      route.channelType === "SavedMessages"
    ) {
      return "messages";
    }
    if (route.channelType) return "servers";
  }
  return undefined;
}

/**
 * Whether the route is the Home page, which phones show inside the sidebar
 * pane (with the bar visible) instead of over it
 * @param path Path without the instance prefix
 */
export function isHomeRoute(path: string): boolean {
  return path === "/app";
}
