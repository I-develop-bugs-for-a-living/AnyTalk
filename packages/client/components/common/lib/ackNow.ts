import type { Channel, Message } from "stoat.js";

/**
 * Acknowledge a message right away, without losing to a pending debounced ack.
 *
 * `Channel.ack(id, true)` sends immediately but leaves an already scheduled
 * debounced ack alone, which would later PUT an older message id and move the
 * server read position backwards. A debounced `ack(id)` first replaces that
 * stale timer with one for the same id, so call it before the immediate one.
 * @param channel Channel to acknowledge in
 * @param message Message or message ID to mark as last read
 */
export function ackNow(channel: Channel, message: Message | string): void {
  channel.ack(message).catch(() => {});
  channel.ack(message, true).catch(() => {});
}
