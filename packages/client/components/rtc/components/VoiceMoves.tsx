import { createEffect, on, onCleanup } from "solid-js";

import { ProtocolV1, VoiceParticipant } from "stoat.js";

import { useClient, useClientLifecycle } from "@revolt/client";
import { State } from "@revolt/client/Controller";
import { useInstance } from "@revolt/instance";

import { tokenRoom } from "../livekitToken";
import { useVoice } from "../state";

/** How long the two halves of our own move may be apart */
const PAIR_WINDOW_MS = 10_000;

/**
 * Follow people being moved between voice channels (see voiceMove.ts):
 * update who is in which channel, and reconnect when we are the one moved
 */
export function VoiceMoves() {
  const voice = useVoice();
  const client = useClient();
  const { config } = useInstance();
  const { lifecycle } = useClientLifecycle();

  // our own move arrives as two events: VoiceChannelMove says where to,
  // UserMoveVoiceChannel brings the token for the new channel
  let target: { channelId: string; at: number } | undefined;
  let auth: { url: string; token: string; at: number } | undefined;

  function followMove() {
    const now = Date.now();
    if (!target || !auth) return;
    if (now - target.at > PAIR_WINDOW_MS || now - auth.at > PAIR_WINDOW_MS)
      return;

    const channel = client().channels.get(target.channelId);
    const { url, token } = auth;
    target = auth = undefined;

    if (channel) {
      voice.connect(channel, { url, token }).catch((err) => {
        console.error("[voice] could not follow move", err);
      });
    }
  }

  function handleEvent(event: ProtocolV1["server"]) {
    if (event.type === "VoiceChannelMove") {
      // stoat.js doesn't update the channels for moves yet
      client().channels.get(event.from)?.voiceParticipants.delete(event.user);
      client()
        .channels.get(event.to)
        ?.voiceParticipants.set(
          event.user,
          new VoiceParticipant(client(), event.state),
        );

      if (event.user === client().user?.id) {
        target = { channelId: event.to, at: Date.now() };
        followMove();
      }
    } else if (event.type === "UserMoveVoiceChannel") {
      const node = config.features.livekit.nodes.find(
        (node) => node.name === event.node,
      );
      if (!node) {
        console.error("[voice] moved to an unknown voice node", event.node);
        return;
      }

      auth = { url: node.public_url, token: event.token, at: Date.now() };

      // the token usually names the new channel already
      const room = tokenRoom(event.token);
      if (room && client().channels.get(room)?.isVoice)
        target = { channelId: room, at: Date.now() };

      followMove();
    }
  }

  createEffect(
    on(lifecycle.state, (state) => {
      if (state !== State.Connected) return;
      const events = client().events;
      events.addListener("event", handleEvent);
      onCleanup(() => events.removeListener("event", handleEvent));
    }),
  );

  return null;
}
