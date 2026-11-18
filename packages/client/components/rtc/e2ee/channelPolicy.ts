/**
 * Decides who may receive our media keys: only people who may be in the
 * call, judged by what the Stoat client knows about the channel, never by
 * LiveKit's roster alone. Someone who was kicked, banned or lost the Connect
 * permission can still reach LiveKit with an old token and show up in the
 * room, but must not get a key. Unknown members count as not allowed until
 * the check passed ("pending"), so a key is never sent early.
 */

/** Access rules of a DM or group call: the channel's recipients. */
export interface RecipientAccess {
  kind: "recipients";
  /** Whether the user is a recipient (or the owner) of the channel. */
  isRecipient(userId: string): boolean;
}

/** Access rules of a server voice channel: members with Connect. */
export interface ServerAccess<M> {
  kind: "server";
  /** Id of the server owner, who may always connect. */
  ownerId(): string | undefined;
  /** The loaded (not partial) member, if the client has it. */
  getMember(userId: string): M | undefined;
  /** Fetches the member from the server; rejects with the API error. */
  fetchMember(userId: string): Promise<unknown>;
  /** Whether the member has the Connect permission on the channel. */
  canConnect(member: M): boolean;
}

/** How a channel decides who may be in its call. */
export type ChannelAccess<M> = RecipientAccess | ServerAccess<M>;

/** The answer function plus a way to drop cached "not a member" results. */
export interface ChannelPolicy {
  /** Whether keys may be sent to this user right now (false while pending). */
  allows(userId: string): boolean;
  /** Forgets what is known about one user, e.g. after the member (re)joined. */
  forget(userId: string): void;
  /**
   * Marks a user as gone (left, kicked or banned): denied whatever the
   * client cache says, and a lookup that is still running is ignored, until
   * {@link forget} is called for them or {@link LEFT_HOLD_MS} passed.
   */
  markLeft(userId: string): void;
}

/** How long a "not a member" answer is trusted before the member is fetched again. */
export const MISSING_RETRY_MS = 10_000;

/** Wait before a failed lookup (not a "not a member" answer) is tried again. */
export const ERROR_RETRY_MS = 3000;

/**
 * How long a user marked as left stays denied without a new join event. The
 * member is out of the client cache by then, so the next check asks the server.
 */
export const LEFT_HOLD_MS = 10_000;

/** API error types that mean the user is not a member of the server. */
const NOT_A_MEMBER = new Set(["NotFound", "NotInServer", "UnknownServer"]);

/** True if an API error says the user is not in the server (and not just a failed request). */
export function isNotAMemberError(error: unknown): boolean {
  const type = (error as { type?: unknown } | undefined)?.type;
  return typeof type === "string" && NOT_A_MEMBER.has(type);
}

/**
 * Creates the policy of one call. `onChange` runs when a member lookup
 * finished and may have changed an answer (call `reevaluate()` there).
 * `now` is injectable for tests.
 */
export function createChannelPolicy<M>(
  access: ChannelAccess<M>,
  onChange: () => void,
  now: () => number = Date.now,
): ChannelPolicy {
  const fetching = new Set<string>();
  /** Per user: earliest time of the next lookup after a failed or negative one. */
  const retryAt = new Map<string, number>();
  /** Users that left, with the time they were marked. */
  const left = new Map<string, number>();

  /** Whether a user is currently held as having left. */
  const hasLeft = (userId: string): boolean => {
    const at = left.get(userId);
    if (at === undefined) return false;
    if (now() - at < LEFT_HOLD_MS) return true;
    left.delete(userId);
    return false;
  };

  /** Starts a member lookup unless one runs or a recent one failed. */
  const lookup = (userId: string): void => {
    if (access.kind !== "server" || fetching.has(userId)) return;
    const next = retryAt.get(userId);
    if (next !== undefined && now() < next) return;
    fetching.add(userId);
    access.fetchMember(userId).then(
      () => {
        fetching.delete(userId);
        retryAt.delete(userId);
        // a leave or kick arrived while the request was in flight: ignore it
        if (!hasLeft(userId)) onChange();
      },
      (error) => {
        fetching.delete(userId);
        // not a member: stay denied for a while; other errors retry soon
        retryAt.set(
          userId,
          now() +
            (isNotAMemberError(error) ? MISSING_RETRY_MS : ERROR_RETRY_MS),
        );
      },
    );
  };

  return {
    allows(userId) {
      if (access.kind === "recipients") return access.isRecipient(userId);
      if (access.ownerId() === userId) return true;
      if (hasLeft(userId)) return false;
      const member = access.getMember(userId);
      if (!member) {
        lookup(userId);
        return false;
      }
      try {
        return access.canConnect(member);
      } catch {
        return false;
      }
    },
    forget(userId) {
      retryAt.delete(userId);
      left.delete(userId);
    },
    markLeft(userId) {
      left.set(userId, now());
    },
  };
}
