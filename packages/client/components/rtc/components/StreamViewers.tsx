import { createEffect, on, onCleanup } from "solid-js";

import { RemoteParticipant, RoomEvent } from "livekit-client";

import { useVoice } from "../state";

/** Data message topic for telling everyone which streams we watch */
const WATCH_TOPIC = "anytalk:watching";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Tell everyone in the call which streams we watch, and keep track of which
 * streams they watch (voice.viewing)
 *
 * Needs the data grant in the LiveKit token, without it nothing arrives
 */
export function StreamViewers() {
  const voice = useVoice();

  createEffect(
    on(voice.room, (room) => {
      if (!room) return;

      /** Streams we watch, our own preview doesn't count */
      const streams = () =>
        [...voice.watching].filter(
          (identity) => identity !== room.localParticipant.identity,
        );

      const tell = (destination?: string) =>
        room.localParticipant
          .publishData(
            encoder.encode(JSON.stringify({ watching: streams() })),
            {
              reliable: true,
              topic: WATCH_TOPIC,
              destinationIdentities: destination ? [destination] : undefined,
            },
          )
          .catch((err) =>
            console.warn("[stream viewers] could not send watching", err),
          );

      // everyone whenever it changes, also once (re)connected, unless there
      // is nothing to tell yet
      let told = false;
      createEffect(
        on(streams, (list) => {
          if (!list.length && !told) return;
          told = true;
          tell();
        }),
      );

      // anyone joining later missed it
      const onJoin = (participant: RemoteParticipant) => {
        if (streams().length) tell(participant.identity);
      };

      const onData = (
        payload: Uint8Array,
        participant?: RemoteParticipant,
        _kind?: unknown,
        topic?: string,
      ) => {
        if (topic !== WATCH_TOPIC || !participant) return;

        let watching: unknown;
        try {
          watching = JSON.parse(decoder.decode(payload)).watching;
        } catch {
          return;
        }

        if (!Array.isArray(watching)) return;
        voice.viewing.set(
          participant.identity,
          watching.filter((identity) => typeof identity === "string"),
        );
      };

      const onLeave = (participant: RemoteParticipant) =>
        voice.viewing.delete(participant.identity);

      room.on(RoomEvent.ParticipantConnected, onJoin);
      room.on(RoomEvent.DataReceived, onData);
      room.on(RoomEvent.ParticipantDisconnected, onLeave);

      onCleanup(() => {
        room.off(RoomEvent.ParticipantConnected, onJoin);
        room.off(RoomEvent.DataReceived, onData);
        room.off(RoomEvent.ParticipantDisconnected, onLeave);
      });
    }),
  );

  return null;
}
