import { createEffect, on, onCleanup } from "solid-js";

import { RoomEvent } from "livekit-client";
import { ProtocolV1 } from "stoat.js";

import { useClient, useClientLifecycle, useSound } from "@revolt/client";
import { State } from "@revolt/client/Controller";

import { useVoice } from "../state";

/** Stop ringing after this long */
const RING_TIMEOUT_MS = 30_000;

/** Vibration while ringing (Android): buzz, pause, buzz, then a break */
const RING_VIBRATION = [400, 200, 400];
const RING_VIBRATION_EVERY_MS = 2400;

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

  /**
   * Play the incoming ringtone, and vibrate along on phones that can
   * @returns Stops both
   */
  function ring() {
    const stopSound = sound.startLoop("ringtoneIncoming");
    if (!sound.canPlay("ringtoneIncoming") || !("vibrate" in navigator))
      return stopSound;

    const vibrate = () => navigator.vibrate(RING_VIBRATION);
    vibrate();
    const timer = setInterval(vibrate, RING_VIBRATION_EVERY_MS);

    return () => {
      stopSound();
      clearInterval(timer);
      navigator.vibrate(0);
    };
  }

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
          stopIncoming = ring();
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

  // ── viewers of our stream (see StreamViewers) ──

  let viewers = new Set<string>();
  createEffect(() => {
    const room = voice.room();
    const sharing = voice.screenshare();
    const now = new Set(
      room && sharing ? voice.viewersOf(room.localParticipant.identity) : [],
    );

    // a stream ending or starting is a sound of its own
    if (sharing) {
      const joined = [...now].some((id) => !viewers.has(id));
      // leaving the call already plays a sound of its own
      const left = [...viewers].some(
        (id) => !now.has(id) && room?.getParticipantByIdentity(id),
      );

      if (joined) sound.playSound("streamViewerJoin");
      else if (left) sound.playSound("streamViewerLeave");
    }

    viewers = now;
  });

  onCleanup(stopRinging);

  return null;
}
