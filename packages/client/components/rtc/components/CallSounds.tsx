import { createEffect, on, onCleanup } from "solid-js";

import { RemoteParticipant, RoomEvent } from "livekit-client";
import { ProtocolV1 } from "stoat.js";

import { useClient, useClientLifecycle, useSound } from "@revolt/client";
import { State } from "@revolt/client/Controller";

import { useVoice } from "../state";

/** Stop ringing after this long */
const RING_TIMEOUT_MS = 30_000;

/** Data message topic for telling a streamer we're watching them */
const WATCH_TOPIC = "anytalk:watching";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Sounds that need more than the call itself: people moving channels,
 * ringing for calls in DMs and groups, and viewers of our stream
 */
export function CallSounds() {
  const voice = useVoice();
  const client = useClient();
  const sound = useSound();
  const { lifecycle } = useClientLifecycle();

  // ── moves and incoming calls, from the server's voice events ──

  let stopIncoming: (() => void) | undefined;
  let ringingChannel: string | undefined;
  let incomingTimer: ReturnType<typeof setTimeout> | undefined;

  function stopRinging() {
    clearTimeout(incomingTimer);
    stopIncoming?.();
    stopIncoming = undefined;
    ringingChannel = undefined;
  }

  function handleEvent(event: ProtocolV1["server"]) {
    const me = client().user?.id;

    if (event.type === "VoiceChannelMove") {
      const ours = voice.channel()?.id;
      if (
        ours &&
        event.user !== me &&
        (event.from === ours || event.to === ours)
      )
        voice.noteMove(event.user);
      return;
    }

    if (
      event.type === "VoiceChannelJoin" ||
      event.type === "VoiceChannelLeave"
    ) {
      // stoat.js updates the channel's participants in its own (async)
      // handler, read them once it has
      setTimeout(() => {
        const channel = client().channels.get(event.id);
        if (!channel) return;

        if (event.type === "VoiceChannelLeave") {
          // the call ended before anyone picked up
          if (ringingChannel === channel.id && !channel.voiceParticipants.size)
            stopRinging();
          return;
        }

        const startedCall =
          (channel.type === "DirectMessage" || channel.type === "Group") &&
          event.state.id !== me &&
          channel.voiceParticipants.size === 1 &&
          voice.channel()?.id !== channel.id &&
          client().user?.presence !== "Busy";

        if (startedCall) {
          stopRinging();
          ringingChannel = channel.id;
          stopIncoming = sound.startLoop("ringtoneIncoming");
          incomingTimer = setTimeout(stopRinging, RING_TIMEOUT_MS);
        }
      });
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

  // picked up
  createEffect(() => {
    if (ringingChannel && voice.channel()?.id === ringingChannel) stopRinging();
  });

  // ── outgoing calls: ring until someone joins us ──

  createEffect(() => {
    const room = voice.room();
    const channel = voice.channel();
    if (
      !room ||
      voice.state() !== "CONNECTED" ||
      !(channel?.type === "DirectMessage" || channel?.type === "Group") ||
      room.remoteParticipants.size
    )
      return;

    const stop = sound.startLoop("ringtoneOutgoing");
    const timer = setTimeout(stop, RING_TIMEOUT_MS);
    room.once(RoomEvent.ParticipantConnected, stop);

    onCleanup(() => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, stop);
      stop();
    });
  });

  // ── stream viewers ──

  // as a viewer: tell streamers when we start and stop watching them
  let told = new Set<string>();
  createEffect(
    on(voice.room, () => {
      told = new Set();
    }),
  );

  createEffect(() => {
    const room = voice.room();
    const watching = new Set(voice.watching);
    if (!room || voice.state() !== "CONNECTED") return;

    const tell = (identity: string, watching: boolean) =>
      room.localParticipant
        .publishData(encoder.encode(JSON.stringify({ watching })), {
          reliable: true,
          topic: WATCH_TOPIC,
          destinationIdentities: [identity],
        })
        .catch(() => {});

    for (const identity of watching) {
      if (identity === room.localParticipant.identity || told.has(identity))
        continue;
      told.add(identity);
      tell(identity, true);
    }

    for (const identity of told) {
      if (watching.has(identity)) continue;
      told.delete(identity);
      // nothing to tell someone who left
      if (room.getParticipantByIdentity(identity)) tell(identity, false);
    }
  });

  // as a streamer: play a sound when people start and stop watching us
  createEffect(() => {
    const room = voice.room();
    if (!room) return;

    const viewers = new Set<string>();

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

      if (watching === true && voice.screenshare()) {
        if (viewers.has(participant.identity)) return;
        viewers.add(participant.identity);
        sound.playSound("streamViewerJoin");
      } else if (watching === false && viewers.delete(participant.identity)) {
        sound.playSound("streamViewerLeave");
      }
    };

    // leaving the call already plays a sound of its own
    const onLeave = (participant: RemoteParticipant) =>
      viewers.delete(participant.identity);

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantDisconnected, onLeave);

    // a new stream starts without viewers
    createEffect(
      on(voice.screenshare, (sharing) => {
        if (!sharing) viewers.clear();
      }),
    );

    onCleanup(() => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantDisconnected, onLeave);
    });
  });

  onCleanup(stopRinging);

  return null;
}
