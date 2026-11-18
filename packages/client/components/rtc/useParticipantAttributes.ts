import { type Accessor, createSignal, onCleanup } from "solid-js";

import { type Participant, ParticipantEvent } from "livekit-client";

/**
 * Follow the attributes a participant shares (see `setAttributes`), for
 * example the deafen state or the streamed program. Reads the current ones
 * at once and updates when they change. Call it inside a component or
 * another reactive owner, it unsubscribes when that is disposed.
 * @param participant The participant to follow
 * @returns The participant's attributes as a signal
 */
export function useParticipantAttributes(
  participant: Participant,
): Accessor<Record<string, string>> {
  const [attributes, setAttributes] = createSignal<Record<string, string>>({
    ...participant.attributes,
  });
  const onAttributes = () => setAttributes({ ...participant.attributes });
  participant.on(ParticipantEvent.AttributesChanged, onAttributes);
  onCleanup(() =>
    participant.off(ParticipantEvent.AttributesChanged, onAttributes),
  );
  return attributes;
}
