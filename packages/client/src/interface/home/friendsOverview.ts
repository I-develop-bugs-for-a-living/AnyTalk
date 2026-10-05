/**
 * A friend, reduced to what the overview needs.
 */
export interface OverviewFriend {
  id: string;
  displayName: string;
  online: boolean;
}

/**
 * A voice channel and the ids of the people in it.
 */
export interface OverviewCall {
  channelId: string;
  userIds: string[];
}

/**
 * An online friend who is in a call.
 */
export interface FriendInCall<
  F extends OverviewFriend,
  C extends OverviewCall,
> {
  friend: F;
  call: C;
  /** Other people in the same call (not counting this friend) */
  others: number;
}

/**
 * Compare two display names for sorting.
 */
function byName(a: { displayName: string }, b: { displayName: string }) {
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Find the online friends who are in a voice call right now, sorted by name.
 * A friend only appears once, for the first call they are found in.
 * @param friends All friends
 * @param calls Voice channels with people in them
 */
export function collectFriendsInCalls<
  F extends OverviewFriend,
  C extends OverviewCall,
>(friends: F[], calls: C[]): FriendInCall<F, C>[] {
  // look people up once instead of searching every call per friend
  const callOf = new Map<string, C>();
  for (const call of calls) {
    for (const userId of call.userIds) {
      if (!callOf.has(userId)) callOf.set(userId, call);
    }
  }

  const result: FriendInCall<F, C>[] = [];
  for (const friend of friends) {
    const call = friend.online ? callOf.get(friend.id) : undefined;
    if (call) {
      result.push({ friend, call, others: call.userIds.length - 1 });
    }
  }

  return result.sort((a, b) => byName(a.friend, b.friend));
}

/**
 * Pick the recent calls to show: still visible, not already listed
 * as a friend's call, in the stored order (most recent first).
 * @param recentIds Stored channel ids, most recent first
 * @param isVisible Whether a channel still exists and can be seen
 * @param hidden Channel ids that are already shown elsewhere
 * @param max Maximum number of calls
 */
export function pickRecentCalls(
  recentIds: string[],
  isVisible: (channelId: string) => boolean,
  hidden: Set<string>,
  max = 5,
): string[] {
  return recentIds
    .filter((id) => !hidden.has(id) && isVisible(id))
    .slice(0, max);
}

/**
 * Online friends who aren't shown as being in a call, sorted by name.
 * @param friends All friends
 * @param inCallIds Ids of friends already shown in a call
 */
export function collectOnlineFriends<F extends OverviewFriend>(
  friends: F[],
  inCallIds: Set<string>,
): F[] {
  return friends
    .filter((friend) => friend.online && !inCallIds.has(friend.id))
    .sort(byName);
}

/**
 * A group of items that share a key, e.g. calls in the same server.
 */
export interface Group<T> {
  key: string;
  items: T[];
}

/**
 * Group items by a key. Groups are ordered by the first item they contain,
 * and items keep their order inside a group.
 * @param items Items in display order
 * @param keyOf Key to group by, e.g. a server id
 */
export function groupByKey<T>(
  items: T[],
  keyOf: (item: T) => string,
): Group<T>[] {
  const groups = new Map<string, Group<T>>();

  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, items: [item] });
  }

  return [...groups.values()];
}
