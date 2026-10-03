import { createSignal } from "solid-js";

import type { Channel, Client } from "stoat.js";

/**
 * Moving people between voice channels by dragging them in the server
 * sidebar (desktop only, needs the Move Members permission)
 */

/** Data type of a dragged voice participant, so other drags are ignored */
export const VOICE_USER_DRAG_TYPE = "application/x-anytalk-voice-user";

export type DraggedVoiceUser = { userId: string; from: Channel };

const [dragged, setDragged] = createSignal<DraggedVoiceUser>();

/** Voice participant being dragged right now, if any */
export const draggedVoiceUser = dragged;
export const setDraggedVoiceUser = setDragged;

/**
 * Whether people in a voice channel can be dragged out of it
 * @param from Their channel
 */
export function canMoveFrom(from: Channel) {
  return !!from.server && from.isVoice && from.havePermission("MoveMembers");
}

/**
 * Whether someone can be moved from one voice channel to another
 * @param from Their channel
 * @param to Target channel
 */
export function canMoveTo(from: Channel, to: Channel) {
  return (
    to.id !== from.id &&
    to.isVoice &&
    !!to.server &&
    to.serverId === from.serverId &&
    canMoveFrom(from) &&
    to.havePermission("MoveMembers")
  );
}

/**
 * Move someone into another voice channel of the same server; the server
 * then tells everyone (VoiceChannelMove), see VoiceMoves
 * @param client Client
 * @param userId User id
 * @param to Target channel
 */
export async function moveVoiceUser(
  client: Client,
  userId: string,
  to: Channel,
) {
  const member = to.server!.getMember(userId);
  if (member) {
    await member.edit({ voice_channel: to.id });
  } else {
    await client.api.patch(
      `/servers/${to.serverId as ""}/members/${userId as ""}`,
      { voice_channel: to.id },
    );
  }
}
