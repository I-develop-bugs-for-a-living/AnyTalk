import { createEffect, on, onCleanup } from "solid-js";

import { RemoteParticipant, RoomEvent } from "livekit-client";

import { useVoice } from "../state";
import {
  WATCH_MIN_INTERVAL_MS,
  createKeyedThrottle,
  sanitizeWatching,
} from "../viewerThrottle";

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

      // after the connection came back (a full reconnect forgets what we
      // sent), unless there is nothing to tell
      createEffect(
        on(
          voice.resyncs,
          () => {
            if (streams().length) tell();
          },
          { defer: true },
        ),
      );

      // anyone joining later missed it
      const onJoin = (participant: RemoteParticipant) => {
        // lists naming someone who just connected were cut short before
        for (const identity of lastLists.keys()) store(identity);
        if (streams().length) tell(participant.identity);
      };

      // at most ~4 messages per second and sender, the latest one still lands
      // once a burst stops; the room is checked when it is applied
      const lastLists = new Map<string, unknown[]>();

      /** Store what a sender watches, checked against who is here now */
      const store = (identity: string) => {
        const list = lastLists.get(identity);
        // sender left while the message was held back
        if (!list || !room.remoteParticipants.has(identity)) return;
        voice.viewing.set(
          identity,
          sanitizeWatching(
            list,
            (id) =>
              id === room.localParticipant.identity ||
              room.remoteParticipants.has(id),
          ),
        );
      };

      const throttle = createKeyedThrottle<unknown[]>(
        WATCH_MIN_INTERVAL_MS,
        (identity, list) => {
          lastLists.set(identity, list);
          store(identity);
        },
      );

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
        throttle.push(participant.identity, watching);
      };

      const onLeave = (participant: RemoteParticipant) => {
        throttle.clear(participant.identity);
        lastLists.delete(participant.identity);
        voice.viewing.delete(participant.identity);
      };

      room.on(RoomEvent.ParticipantConnected, onJoin);
      room.on(RoomEvent.DataReceived, onData);
      room.on(RoomEvent.ParticipantDisconnected, onLeave);

      onCleanup(() => {
        throttle.dispose();
        room.off(RoomEvent.ParticipantConnected, onJoin);
        room.off(RoomEvent.DataReceived, onData);
        room.off(RoomEvent.ParticipantDisconnected, onLeave);
      });
    }),
  );

  return null;
}
