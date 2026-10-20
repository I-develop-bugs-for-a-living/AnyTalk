/**
 * Maximum number of mentions shown in the inbox
 */
export const INBOX_LIMIT = 50;

/**
 * Maximum number of message requests running at the same time
 */
export const INBOX_FETCH_CONCURRENCY = 5;

/**
 * Message flag: no notification for this message
 */
export const FLAG_SUPPRESS_NOTIFICATIONS = 1;

/**
 * Message flag: mentions everyone who can see the channel
 */
export const FLAG_MENTIONS_EVERYONE = 2;

/**
 * What the inbox needs to know about a freshly received message
 */
export interface LiveMessage {
  /**
   * Author of the message
   */
  authorId?: string;

  /**
   * ID of the logged in user
   */
  userId?: string;

  /**
   * Message flags bit field
   */
  flags: number;

  /**
   * Whether the channel is a DM or a group
   */
  isConversation: boolean;

  /**
   * Roles the message mentions
   */
  roleMentionIds?: string[];

  /**
   * Roles the logged in user holds in the message's server
   */
  memberRoleIds?: string[];
}

/**
 * Whether a live message belongs in the inbox even though the library does
 * not add it to `channel.mentions`: any message in a DM or group, and
 * messages mentioning a role we hold or @everyone. Own messages and
 * messages with notifications suppressed never count.
 * @param message Message facts
 * @returns Whether to track the message as an extra mention
 */
export function isExtraMention(message: LiveMessage): boolean {
  if (message.authorId && message.authorId === message.userId) return false;
  if (message.flags & FLAG_SUPPRESS_NOTIFICATIONS) return false;
  if (message.isConversation) return true;
  if (message.flags & FLAG_MENTIONS_EVERYONE) return true;
  const held = message.memberRoleIds ?? [];
  return !!message.roleMentionIds?.some((id) => held.includes(id));
}

/**
 * Whether a message is newer than the last read message of its channel
 * (message IDs are ULIDs, so they compare by time).
 * @param messageId Message ID
 * @param lastReadId Last read message ID of the channel, if any
 * @returns Whether the message is still unread
 */
export function isStillUnread(
  messageId: string,
  lastReadId: string | undefined,
): boolean {
  return !lastReadId || messageId > lastReadId;
}

/**
 * Merge the server's mention IDs with the ones tracked live, without
 * duplicates. Live ones that were read since are dropped.
 * @param serverIds `channel.mentions`
 * @param liveIds Extra IDs tracked from live messages
 * @param lastReadId Last read message ID of the channel
 * @returns Merged IDs
 */
export function mergeMentionIds(
  serverIds: Iterable<string> | undefined,
  liveIds: Iterable<string> | undefined,
  lastReadId: string | undefined,
): Set<string> {
  const merged = new Set<string>(serverIds);
  for (const id of liveIds ?? []) {
    if (isStillUnread(id, lastReadId)) merged.add(id);
  }
  return merged;
}

/**
 * The parts of a channel the inbox needs to look at
 */
export interface MentionSource {
  /**
   * Channel ID
   */
  id: string;

  /**
   * Whether the channel (or its server) is muted
   */
  muted: boolean;

  /**
   * IDs of unread messages that mention the user
   */
  mentions?: Iterable<string>;
}

/**
 * One unread mention: the channel and the ID of the message
 */
export interface MentionRef<T extends MentionSource> {
  channel: T;
  messageId: string;
}

/**
 * Collect unread mentions from unmuted channels, newest first.
 * Message IDs are ULIDs, so sorting the IDs sorts by time.
 * Messages known to be gone are removed before the cap is applied, so
 * deleted messages never take up one of the slots.
 * @param channels Channels to look through
 * @param failed IDs of messages that could not be loaded (deleted)
 * @param limit Maximum number of entries to return
 * @returns Mentions, newest first
 */
export function collectMentions<T extends MentionSource>(
  channels: Iterable<T>,
  failed: ReadonlySet<string> = new Set(),
  limit = INBOX_LIMIT,
): MentionRef<T>[] {
  const refs: MentionRef<T>[] = [];

  for (const channel of channels) {
    if (channel.muted || !channel.mentions) continue;
    for (const messageId of channel.mentions) {
      if (failed.has(messageId)) continue;
      refs.push({ channel, messageId });
    }
  }

  refs.sort((a, b) => (a.messageId < b.messageId ? 1 : -1));
  return refs.slice(0, limit);
}

/**
 * Count unread mentions in unmuted channels (not capped)
 * @param channels Channels to look through
 * @param failed IDs of messages that could not be loaded (deleted)
 * @returns Number of mentions
 */
export function countMentions(
  channels: Iterable<MentionSource>,
  failed: ReadonlySet<string> = new Set(),
): number {
  let count = 0;
  for (const channel of channels) {
    if (channel.muted || !channel.mentions) continue;
    for (const id of channel.mentions) {
      if (!failed.has(id)) count++;
    }
  }
  return count;
}

/**
 * Whether a channel has anything to show in the inbox
 * @param channel Channel to check
 * @returns True for unmuted channels with at least one mention
 */
export function hasMentions(channel: MentionSource): boolean {
  if (channel.muted || !channel.mentions) return false;
  for (const _ of channel.mentions) return true;
  return false;
}

/**
 * Whether a failed message request means the message is gone. The API
 * client throws the raw response body (a JSON string such as
 * `{"type":"NotFound"}`) for any non-2xx answer; network failures throw
 * other things and 5xx or 429 answers have different types, which are
 * temporary and must not be remembered.
 * @param error Whatever the request threw
 * @returns True only for a real "not found"
 */
export function isNotFoundError(error: unknown): boolean {
  let value = error;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (typeof value !== "object" || value === null) return false;
  const { type, status } = value as { type?: unknown; status?: unknown };
  return type === "NotFound" || type === "UnknownMessage" || status === 404;
}

/**
 * Rejection reason of a limiter task that was skipped because it was
 * cancelled while waiting in the queue
 */
export const CANCELLED = Symbol("cancelled");

/**
 * Create a function that runs async tasks, at most `limit` at a time.
 * Tasks beyond the limit wait in a queue, oldest first.
 * @param limit Maximum number of tasks running at once
 * @returns Function which queues a task and resolves with its result. If
 * `cancelled()` is true when the task is due, it is skipped and rejects
 * with `CANCELLED`.
 */
export function createLimiter(limit: number) {
  let running = 0;
  const queue: (() => void)[] = [];

  /**
   * Start queued tasks while there is room
   */
  const next = () => {
    while (running < limit && queue.length) queue.shift()!();
  };

  return <R>(task: () => Promise<R>, cancelled?: () => boolean): Promise<R> =>
    new Promise<R>((resolve, reject) => {
      queue.push(() => {
        // the caller went away while this waited: skip the request
        if (cancelled?.()) {
          reject(CANCELLED);
          return;
        }
        running++;
        task()
          .then(resolve, reject)
          .finally(() => {
            running--;
            next();
          });
      });
      next();
    });
}
