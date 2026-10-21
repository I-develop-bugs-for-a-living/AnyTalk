import type { Client, Message } from "stoat.js";

/**
 * Pin or unpin a message and update the local copy right away.
 *
 * The server reports an unpin as a MessageUpdate with `clear: ["Pinned"]`,
 * which stoat.js ignores, so the local `pinned` flag would stay true.
 * We therefore set it ourselves once the request succeeded.
 *
 * @param client Client that owns the message
 * @param message Message to change
 * @param pinned Whether the message should end up pinned
 */
export async function setMessagePinned(
  client: Client,
  message: Message,
  pinned: boolean,
): Promise<void> {
  await (pinned ? message.pin() : message.unpin());
  // Only update a message that is already stored, to avoid a partial entry
  if (client.messages.has(message.id)) {
    client.messages.updateUnderlyingObject(message.id, { pinned });
  }
}
