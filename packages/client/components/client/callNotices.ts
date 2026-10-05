import type { Channel, Client, Message } from "stoat.js";

/** Maximum number of messages fetched per channel when checking on startup */
const STARTUP_FETCH_LIMIT = 15;

/**
 * Whether a message is the hidden "X started a call" system notice
 * @param message Anything with an optional system message
 */
export function isHiddenCallNotice(message: {
  systemMessage?: { type: string };
}): boolean {
  return message.systemMessage?.type === "call_started";
}

/**
 * Decide which message to acknowledge after a new message arrived live.
 *
 * Only a hidden call notice in a channel that was fully read right before it
 * is acknowledged.
 * @param unreadMarker Last read message id of the channel
 * @param previousLastMessageId Last message id of the channel before the new message
 * @param message The new message
 * @returns Id to acknowledge, if any
 */
export function liveAckTarget(
  unreadMarker: string | undefined,
  previousLastMessageId: string | undefined,
  message: { id: string; systemMessage?: { type: string } },
): string | undefined {
  if (!isHiddenCallNotice(message)) return undefined;
  if (previousLastMessageId === message.id) return undefined;

  // an empty channel has nothing unread before the notice
  if (!previousLastMessageId) return message.id;

  return (unreadMarker ?? "0").localeCompare(previousLastMessageId) >= 0
    ? message.id
    : undefined;
}

/**
 * Decide which message to acknowledge from the messages after the read marker.
 * @param messages Messages after the marker, oldest first
 * @param limit Number of messages that was requested
 * @returns Id of the newest message if all of them are hidden call notices
 */
export function startupAckTarget(
  messages: { id: string; systemMessage?: { type: string } }[],
  limit: number,
): string | undefined {
  // reaching the limit means there may be more (real) unread messages
  if (messages.length === 0 || messages.length >= limit) return undefined;
  if (!messages.every(isHiddenCallNotice)) return undefined;

  // the API returns oldest first, so the newest is the last one
  return messages[messages.length - 1].id;
}

/**
 * Whether a channel can contain call notices
 * @param channel Channel
 */
function canHaveCalls(channel: Channel): boolean {
  return channel.type !== "SavedMessages" && channel.isVoice;
}

/**
 * Acknowledge hidden call notices in channels that only look unread because
 * of them. Sequential, so the API is not flooded.
 * @param client Client
 * @param isCurrent Whether this sweep is still the latest one
 */
async function ackStartupNotices(
  client: Client,
  isCurrent: () => boolean,
): Promise<void> {
  const channels = client.channels
    .toList()
    .filter((channel) => canHaveCalls(channel) && channel.unread);

  for (const channel of channels) {
    // stop when a newer sweep started or the client went away
    if (!isCurrent() || !client.ready()) return;

    try {
      const unread = client.channelUnreads.for(channel);

      // mentions are real unread messages
      if (unread.messageMentionIds.size > 0 || !unread.lastMessageId) continue;

      const messages = await channel.fetchMessages({
        after: unread.lastMessageId,
        limit: STARTUP_FETCH_LIMIT,
        sort: "Oldest",
      });

      const target = startupAckTarget(messages, STARTUP_FETCH_LIMIT);
      if (target) await channel.ack(target, true);
    } catch (error) {
      console.warn("[call notices] failed to check channel", channel.id, error);
    }
  }
}

/**
 * Keep hidden call notices from marking channels as unread, both for new
 * messages and for those that arrived while the client was offline.
 * @param client Client to listen on
 */
export function autoAckCallNotices(client: Client): void {
  // last message id per channel before the newest message, tracked here as
  // the library updates `lastMessageId` around the time the event fires
  const lastSeen = new Map<string, string | undefined>();

  client.on("messageCreate", (message: Message) => {
    const channel = message.channel;
    if (!channel || !canHaveCalls(channel)) return;

    const previous = lastSeen.has(channel.id)
      ? lastSeen.get(channel.id)
      : channel.lastMessageId;
    lastSeen.set(channel.id, message.id);

    const unread = client.channelUnreads.for(channel);
    const hasMentions = unread.messageMentionIds.size > 0;
    const target = hasMentions
      ? undefined
      : liveAckTarget(unread.lastMessageId, previous, message);

    if (target) void channel.ack(target, true);
  });

  // bumped on every ready so an older sweep stops at its next channel
  let generation = 0;

  client.on("ready", () => {
    // forget cached ids, the sync may have moved them
    lastSeen.clear();
    const current = ++generation;
    void ackStartupNotices(client, () => current === generation);
  });
}
