/**
 * Connects Stoat client events to the call's access policy: after anything
 * that can change who may be in the call, the E2EE session is re-checked.
 * Events of other servers and channels are ignored, and member events only
 * touch the member they are about.
 */
import type { ChannelPolicy } from "./channelPolicy";

/**
 * Event handler. The arguments differ per event (servers, members,
 * channels), so they are checked structurally inside each handler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AccessHandler = (...args: any[]) => void;

/** The part of the Stoat client (an event emitter) this needs. */
export interface AccessEventSource {
  on(event: string, handler: AccessHandler): unknown;
  off(event: string, handler: AccessHandler): unknown;
}

/** The call a policy belongs to. */
export interface AccessTarget {
  /** Id of the call's channel. */
  channelId: string;
  /** Id of the channel's server, if it is a server channel. */
  serverId?: string;
}

/** Anything with an `id`: servers, channels, and the keys of members. */
interface HasId {
  id?: unknown;
}

/**
 * Subscribes to the events that change access and returns the function that
 * removes the listeners again. `reevaluate` runs after every relevant event.
 *
 * Ordering on `serverMemberLeave`: stoat.js emits it BEFORE it deletes the
 * member from its cache, and `reevaluate` runs the check in a later
 * microtask, so it may still see the cached member. That is why the leave is
 * also recorded in the policy (`markLeft`): the user stays denied no matter
 * what the cache says, until a join event for them arrives.
 */
export function wireAccessEvents(
  source: AccessEventSource,
  target: AccessTarget,
  policy: ChannelPolicy,
  reevaluate: () => void,
): () => void {
  const subscriptions: [string, AccessHandler][] = [];
  const add = (event: string, handler: AccessHandler) => {
    source.on(event, handler);
    subscriptions.push([event, handler]);
  };

  /** Server events: only the call's server. */
  const ofServer = (server?: HasId) =>
    target.serverId !== undefined && server?.id === target.serverId;
  /** Channel events: only the call's channel. */
  const ofChannel = (channel?: HasId) => channel?.id === target.channelId;
  /** The user id of a member (class or hydrated object) of the call's server. */
  const memberOf = (member?: {
    id?: { server?: string; user?: string };
  }): string | undefined =>
    target.serverId !== undefined && member?.id?.server === target.serverId
      ? member.id.user
      : undefined;

  add("serverMemberJoin", (member) => {
    const user = memberOf(member);
    if (user === undefined) return;
    policy.forget(user);
    reevaluate();
  });
  add("serverMemberLeave", (member) => {
    const user = memberOf(member);
    if (user === undefined) return;
    policy.markLeft(user);
    reevaluate();
  });
  add("serverMemberUpdate", (member) => {
    if (memberOf(member) !== undefined) reevaluate();
  });
  for (const event of [
    "serverUpdate",
    "serverRoleUpdate",
    "serverRoleRanksUpdate",
    "serverRoleDelete",
    "serverDelete",
  ]) {
    add(event, (server) => {
      if (ofServer(server)) reevaluate();
    });
  }
  for (const event of [
    "channelUpdate",
    "channelDelete",
    "channelGroupJoin",
    "channelGroupLeave",
  ]) {
    add(event, (channel) => {
      if (ofChannel(channel)) reevaluate();
    });
  }

  return () => {
    for (const [event, handler] of subscriptions) source.off(event, handler);
    subscriptions.length = 0;
  };
}
