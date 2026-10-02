import { Show, createSignal, onCleanup } from "solid-js";
import { useEnsureParticipant } from "solid-livekit-components";

import { useLingui } from "@lingui/solid/macro";
import {
  ConnectionQuality,
  Participant,
  ParticipantEvent,
} from "livekit-client";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * A participant's connection quality as worked out by the LiveKit server
 * from their loss, jitter and ping; updates every few seconds
 */
export function useConnectionQuality(participant: Participant) {
  const [quality, setQuality] = createSignal(participant.connectionQuality);
  const update = (q: ConnectionQuality) => setQuality(q);

  participant.on(ParticipantEvent.ConnectionQualityChanged, update);
  onCleanup(() =>
    participant.off(ParticipantEvent.ConnectionQualityChanged, update),
  );

  return quality;
}

const ICONS: Partial<
  Record<ConnectionQuality, { icon: string; color: string }>
> = {
  [ConnectionQuality.Excellent]: {
    icon: "signal_cellular_alt",
    color: "var(--customColours-success-color, #4caf50)",
  },
  [ConnectionQuality.Good]: {
    icon: "signal_cellular_alt_2_bar",
    color: "var(--customColours-warning-color, #faa352)",
  },
  [ConnectionQuality.Poor]: {
    icon: "signal_cellular_alt_1_bar",
    color: "var(--md-sys-color-error)",
  },
  [ConnectionQuality.Lost]: {
    icon: "signal_cellular_connected_no_internet_0_bar",
    color: "var(--md-sys-color-error)",
  },
};

/**
 * Signal bars for the participant in the current track context
 */
export function ConnectionQualityIcon() {
  const { t } = useLingui();
  const participant = useEnsureParticipant();
  const quality = useConnectionQuality(participant);

  const label = () => {
    switch (quality()) {
      case ConnectionQuality.Excellent:
        return t`Excellent connection`;
      case ConnectionQuality.Good:
        return t`Good connection`;
      case ConnectionQuality.Poor:
        return t`Poor connection`;
      case ConnectionQuality.Lost:
        return t`Connection lost`;
    }
  };

  return (
    <Show when={ICONS[quality()]}>
      {(style) => (
        <span
          // inline: Panda can't generate classes for colours picked at runtime
          style={{ display: "flex", color: style().color }}
          use:floating={{ tooltip: { placement: "top", content: label() } }}
        >
          <Symbol size={18}>{style().icon}</Symbol>
        </span>
      )}
    </Show>
  );
}
