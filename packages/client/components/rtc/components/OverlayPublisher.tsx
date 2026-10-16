import { useLingui } from "@lingui/solid/macro";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import {
  type Participant,
  ParticipantEvent,
  RoomEvent,
  Track,
} from "livekit-client";

import { useClient } from "@revolt/client";
import { KeybindAction, createKeybind } from "@revolt/keybinds";
import { userInformation } from "@revolt/markdown/users";

import {
  overlayAvailable,
  overlayEnabled,
  saveOverlaySettings,
} from "../overlayConfig";
import {
  type OverlayParticipantState,
  type OverlayStateSnapshot,
  EMPTY_OVERLAY_STATE,
  buildOverlayState,
  sameOverlayState,
} from "../overlaySnapshot";
import { useFastIsSpeaking } from "../speaking";
import { useVoice } from "../state";

/** Shortest time between two snapshots sent to the desktop shell */
const MIN_GAP_MS = 80;

/**
 * Desktop app only, always mounted: handles the "toggle overlay" hotkey and,
 * while the overlay is on, sends the call state to the in-game overlay window
 */
export function OverlayPublisher() {
  // checked once: the shell doesn't gain the bridge while running
  if (overlayAvailable()) {
    createKeybind(KeybindAction.TOGGLE_OVERLAY, () => {
      saveOverlaySettings({ overlayEnabled: !overlayEnabled() });
    });
  }

  return (
    <Show when={overlayAvailable() && overlayEnabled()}>
      <SnapshotSender />
    </Show>
  );
}

/**
 * Collect who is in the call, who speaks and who streams, and send each
 * change (coalesced) to the desktop shell
 */
function SnapshotSender() {
  const voice = useVoice();
  const { t } = useLingui();

  /** Everyone in the room, ourselves first */
  const [participants, setParticipants] = createSignal<Participant[]>([]);
  createEffect(() => {
    const room = voice.room();
    if (!room) {
      setParticipants([]);
      return;
    }
    // our own identity is empty until the join finished, so connect and
    // reconnect refresh too; participants without identity are left out
    const refresh = () =>
      setParticipants(
        [room.localParticipant, ...room.remoteParticipants.values()].filter(
          (p) => p.identity,
        ),
      );
    refresh();
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ] as const;
    events.forEach((event) => room.on(event, refresh));
    onCleanup(() => events.forEach((event) => room.off(event, refresh)));
  });

  /** Latest data by participant id, filled in by the reporters below */
  const [known, setKnown] = createSignal<
    Record<string, OverlayParticipantState | undefined>
  >({});

  const inCall = () =>
    !!voice.room() &&
    (voice.state() === "CONNECTED" || voice.state() === "RECONNECTING");

  const snapshot = createMemo(() =>
    buildOverlayState(
      inCall(),
      participants().map((p) => p.identity),
      known(),
    ),
  );

  let lastSentAt = 0;
  let lastSent: OverlayStateSnapshot | undefined;
  let pending: OverlayStateSnapshot | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Send the newest snapshot unless it matches the last one sent */
  const flush = () => {
    timer = undefined;
    const next = pending;
    pending = undefined;
    if (!next || (lastSent && sameOverlayState(lastSent, next))) return;
    lastSent = next;
    lastSentAt = Date.now();
    window.native
      .setOverlayState?.({
        ...next,
        liveLabel: t`LIVE`,
        mutedLabel: t`Muted`,
        deafenedLabel: t`Deafened`,
      })
      ?.catch(() => {});
  };

  createEffect(() => {
    pending = snapshot();
    if (timer) return;
    // speaking flips often, so keep a gap between messages
    timer = setTimeout(
      flush,
      Math.max(0, MIN_GAP_MS - (Date.now() - lastSentAt)),
    );
  });

  onCleanup(() => {
    clearTimeout(timer);
    // overlay turned off or the call ended: clear what the shell remembers
    window.native.setOverlayState?.(EMPTY_OVERLAY_STATE)?.catch(() => {});
  });

  return (
    <For each={participants()}>
      {(participant) => (
        <ParticipantReporter
          participant={participant}
          onReport={(id, value) => setKnown((all) => ({ ...all, [id]: value }))}
        />
      )}
    </For>
  );
}

/**
 * Invisible: follows one participant (name, avatar, speaking, stream) and
 * reports it to the sender. Each one owns the speaking detector it needs.
 */
function ParticipantReporter(props: {
  participant: Participant;
  onReport: (id: string, value: OverlayParticipantState | undefined) => void;
}) {
  const voice = useVoice();
  const client = useClient();
  // the row is keyed by object, so the participant itself never changes;
  // the identity is read each time because it can be filled in late
  // eslint-disable-next-line solid/reactivity
  const participant = props.participant;
  const id = () => participant.identity;

  const speaking = useFastIsSpeaking(participant);

  /** Whether a screen share (or game stream) is published */
  const [streaming, setStreaming] = createSignal(false);
  const updateStreaming = () =>
    setStreaming(!!participant.getTrackPublication(Track.Source.ScreenShare));
  updateStreaming();
  const events = [
    ParticipantEvent.TrackPublished,
    ParticipantEvent.TrackUnpublished,
    ParticipantEvent.LocalTrackPublished,
    ParticipantEvent.LocalTrackUnpublished,
  ] as const;
  events.forEach((event) => participant.on(event, updateStreaming));
  onCleanup(() =>
    events.forEach((event) => participant.off(event, updateStreaming)),
  );

  /** Whether the microphone track is missing or muted */
  const [trackMuted, setTrackMuted] = createSignal(true);
  /** Deafen state other clients share as a participant attribute */
  const [sharedDeafen, setSharedDeafen] = createSignal(false);
  const updateMedia = () => {
    const publication = participant.getTrackPublication(
      Track.Source.Microphone,
    );
    setTrackMuted(!publication || publication.isMuted);
    // only read for remote participants, we know our own state
    if (!participant.isLocal)
      setSharedDeafen(participant.attributes?.deafened === "true");
  };
  updateMedia();
  const mediaEvents = [
    ParticipantEvent.TrackPublished,
    ParticipantEvent.TrackUnpublished,
    ParticipantEvent.LocalTrackPublished,
    ParticipantEvent.LocalTrackUnpublished,
    ParticipantEvent.TrackMuted,
    ParticipantEvent.TrackUnmuted,
    ParticipantEvent.AttributesChanged,
  ] as const;
  mediaEvents.forEach((event) => participant.on(event, updateMedia));
  onCleanup(() =>
    mediaEvents.forEach((event) => participant.off(event, updateMedia)),
  );
  // our own state is known locally, the attribute only serves the others
  const deafened = () =>
    participant.isLocal ? voice.deafen() : sharedDeafen();
  // Push to talk closes the mic track while the key is up, so for ourselves
  // the mute setting is used. A remote push to talk user shows as muted while
  // idle, as nothing tells it apart from a real mute.
  const muted = () =>
    participant.isLocal ? !voice.microphone() : trackMuted();

  /** Name and avatar: server nickname and avatar before the account's */
  let requested = false;
  const info = createMemo(() => {
    const c = client();
    const user = c.users.get(id());
    if (!user && !requested) {
      // not loaded yet, the memo runs again once it arrives
      requested = true;
      c.users.fetch(id()).catch(() => undefined);
    }
    const serverId = voice.channel()?.serverId;
    return userInformation(
      user,
      user && serverId
        ? c.serverMembers.getByKey({ server: serverId, user: id() })
        : undefined,
    );
  });

  createEffect(() => {
    const current = id();
    props.onReport(current, {
      id: current,
      name: info().username,
      avatar: info().avatar,
      speaking: speaking(),
      streaming: streaming(),
      muted: muted(),
      deafened: deafened(),
    });
    // drop the entry of the old id if the identity ever changes
    onCleanup(() => props.onReport(current, undefined));
  });

  return null;
}
