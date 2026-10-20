import { batch } from "solid-js";

import { type Client, ConnectionState } from "stoat.js";

/**
 * Local unread state of one channel
 */
export interface LocalUnread {
  /**
   * Last read message ID
   */
  lastMessageId?: string;

  /**
   * IDs of unread messages that mention the user
   */
  mentions: Iterable<string>;
}

/**
 * Unread state of one channel as the server reports it
 */
export interface ServerUnread {
  /**
   * Last read message ID
   */
  last_id?: string | null;

  /**
   * IDs of unread messages that mention the user
   */
  mentions?: string[] | null;
}

/**
 * What to change locally to catch up with the server
 */
export interface UnreadUpdate {
  /**
   * New last read message ID, if the server is ahead
   */
  lastMessageId?: string;

  /**
   * Mentions to add
   */
  addMentions: string[];

  /**
   * Mentions to drop (read on another device)
   */
  removeMentions: string[];
}

/**
 * Work out how to merge the server's unread state into the local one
 * without ever moving the local read position backwards (acks are sent
 * with a delay, so the server can be behind). Message IDs are ULIDs, so
 * they compare by time.
 * @param local Local state of the channel
 * @param server State the server reported
 * @returns Changes to apply locally
 */
export function planUnreadUpdate(
  local: LocalUnread,
  server: ServerUnread,
): UnreadUpdate {
  const serverRead = server.last_id ?? undefined;
  const localRead = local.lastMessageId;
  const lastMessageId =
    serverRead && (!localRead || serverRead > localRead)
      ? serverRead
      : undefined;
  const read = lastMessageId ?? localRead;

  const localMentions = new Set(local.mentions);
  const addMentions = (server.mentions ?? []).filter(
    (id) => !localMentions.has(id) && (!read || id > read),
  );
  // mentions the server no longer lists and that lie before its read position
  const serverMentions = new Set(server.mentions ?? []);
  const removeMentions = serverRead
    ? [...localMentions].filter(
        (id) => id <= serverRead && !serverMentions.has(id),
      )
    : [];

  return { lastMessageId, addMentions, removeMentions };
}

/**
 * Fetch the unread state again and merge it into the client.
 *
 * The library only loads unreads into channels it has not seen before, so
 * after a reconnect on the same client (common on phones, which suspend
 * tabs and drop the socket) mentions that arrived while offline would never
 * appear. This catches up.
 * @param client Client to update
 */
export async function resyncUnreads(client: Client): Promise<void> {
  const unreads = await client.api.get("/sync/unreads");

  batch(() => {
    for (const unread of unreads) {
      const channelId = unread._id.channel;
      const local = client.channelUnreads.get(channelId);

      if (!local) {
        client.channelUnreads.getOrCreate(channelId, unread);
        continue;
      }

      const plan = planUnreadUpdate(
        {
          lastMessageId: local.lastMessageId,
          mentions: local.messageMentionIds,
        },
        unread,
      );

      if (plan.lastMessageId) {
        client.channelUnreads.updateUnderlyingObject(
          channelId,
          "lastMessageId",
          plan.lastMessageId,
        );
      }
      plan.addMentions.forEach((id) => local.messageMentionIds.add(id));
      plan.removeMentions.forEach((id) => local.messageMentionIds.delete(id));
    }
  });
}

/**
 * Delay before the one retry of a failed resync, in milliseconds. The
 * network is often not ready yet when "ready" fires after a phone wakes.
 */
export const RESYNC_RETRY_DELAY = 2000;

/**
 * Minimum time between two visibility-triggered resyncs, in milliseconds
 */
export const RESYNC_THROTTLE = 5000;

/**
 * Delay of the second resync pass after a trigger, in milliseconds. The
 * API writes unread mentions and the last message of a channel from
 * background tasks 5 to 15 seconds after a message is sent, so a page that
 * loads within that window gets stale data.
 */
export const RESYNC_LAG_DELAY = 20000;

/**
 * Pick the newer of two message IDs (ULIDs compare by time), so a value is
 * never moved backwards.
 * @param local Current local ID, if any
 * @param remote ID reported by the server, if any
 * @returns The ID to set, or undefined if the local one is already newest
 */
export function newerMessageId(
  local: string | undefined,
  remote: string | null | undefined,
): string | undefined {
  if (!remote) return undefined;
  return !local || remote > local ? remote : undefined;
}

/**
 * Move `lastMessageId` of known channels forward from fresh channel data
 * @param client Client to update
 * @param channels Channel data from the API
 */
function applyLastMessageIds(
  client: Client,
  channels: { _id: string; last_message_id?: string | null }[],
): void {
  batch(() => {
    for (const data of channels) {
      const channel = client.channels.get(data._id);
      const next = newerMessageId(channel?.lastMessageId, data.last_message_id);
      if (next) {
        client.channels.updateUnderlyingObject(data._id, "lastMessageId", next);
      }
    }
  });
}

/**
 * How many server requests run at the same time when refreshing
 */
export const REFRESH_CONCURRENCY = 3;

/**
 * Minimum time between two full refreshes of the last message IDs, in
 * milliseconds
 */
export const REFRESH_MIN_INTERVAL = 60000;

/**
 * Refresh `lastMessageId` of every channel, forward only, so plain unreads
 * (without a mention) show up too. Reads direct messages and groups in one
 * request and every server's channels in one request each (a few at a
 * time). A failed request is skipped.
 * @param client Client to update
 * @param isCancelled Returns true once the work should stop
 */
export async function refreshLastMessageIds(
  client: Client,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  try {
    const dms: unknown = await client.api.get("/users/dms");
    // the generated route type is a union that does not match the real
    // answer (a list of channels), so it is read as unknown and checked
    if (Array.isArray(dms) && !isCancelled()) {
      applyLastMessageIds(
        client,
        dms as Parameters<typeof applyLastMessageIds>[1],
      );
    }
  } catch {
    // skip, the next pass tries again
  }

  const servers = client.servers.toList();
  let next = 0;

  /**
   * Take servers off the shared list until it is empty or cancelled
   */
  const worker = async () => {
    while (!isCancelled() && next < servers.length) {
      const server = servers[next++];
      try {
        const data = await client.api.get(`/servers/${server.id as ""}`, {
          include_channels: true,
        });
        if (isCancelled()) return;
        applyLastMessageIds(
          client,
          (data.channels as unknown[]).filter(
            (channel): channel is { _id: string; last_message_id?: string } =>
              typeof channel === "object" && channel !== null,
          ),
        );
      } catch {
        // skip this server
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(REFRESH_CONCURRENCY, servers.length) },
      worker,
    ),
  );
}

/**
 * Handle returned by `autoResyncUnreads`
 */
export interface UnreadResyncer {
  /**
   * Request a resync, throttled to once per `RESYNC_THROTTLE`; never throws
   */
  request: () => void;

  /**
   * Cancel a pending delayed pass (call when the client is disposed)
   */
  cancel: () => void;
}

/**
 * Catch up on unreads whenever the client becomes ready, and on request
 * (for example when the page becomes visible again, when a restored tab may
 * have missed events without a new "ready"). Merging is idempotent, so it is
 * safe to run on every ready, including the first. A failed fetch is retried
 * once after a short delay; if that fails too it is only logged in dev, and
 * the next trigger tries again.
 *
 * Every run schedules one more pass `RESYNC_LAG_DELAY` later, which also
 * refreshes the last message of each channel; a newer trigger replaces a
 * pending pass.
 *
 * Note: every connect fetches /sync/unreads twice, once by the library's own
 * sync (which ignores data for known channels) and once here (which merges
 * it). This is intended, because the library cannot be changed from this app.
 * @param client Client to watch
 * @returns Request and cancel functions
 */
export function autoResyncUnreads(client: Client): UnreadResyncer {
  let lastRun = -Infinity;
  let lastRefresh = -Infinity;
  let cancelled = false;
  let lagTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const isCancelled = () => cancelled;
  const isConnected = () => client.events.state() === ConnectionState.Connected;

  /**
   * Run a resync with one retry; never throws
   * @param full Whether to refresh last message IDs too
   */
  const run = (full = false) => {
    lastRun = Date.now();
    const task = async () => {
      if (cancelled) return;
      const jobs: Promise<void>[] = [resyncUnreads(client)];
      if (
        full &&
        Date.now() - lastRefresh >= REFRESH_MIN_INTERVAL &&
        (client.servers.toList().length > 0 || client.channels.toList().length)
      ) {
        lastRefresh = Date.now();
        jobs.push(refreshLastMessageIds(client, isCancelled));
      }
      // one failing must not skip the other; rethrow so the retry runs
      const results = await Promise.allSettled(jobs);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;
    };
    task().catch(() => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        task().catch((error) => {
          if (import.meta.env.DEV) {
            console.warn("[unreads] resync failed", error);
          }
        });
      }, RESYNC_RETRY_DELAY);
    });
  };

  /**
   * Run now and schedule the delayed pass, replacing pending timers
   */
  const trigger = () => {
    if (cancelled) return;
    clearTimeout(retryTimer);
    run();
    clearTimeout(lagTimer);
    lagTimer = setTimeout(() => {
      // the next "ready" schedules a new pass anyway
      if (isConnected()) run(true);
    }, RESYNC_LAG_DELAY);
  };

  client.on("ready", trigger);

  return {
    request: () => {
      if (Date.now() - lastRun >= RESYNC_THROTTLE) trigger();
    },
    cancel: () => {
      cancelled = true;
      clearTimeout(lagTimer);
      clearTimeout(retryTimer);
    },
  };
}
