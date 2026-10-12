import { Trans } from "@lingui/solid/macro";
import { Show } from "solid-js";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Connection hint, only shown while the call is reconnecting or has dropped
 * and is gone again once it is connected
 */
export function VoiceCallCardStatus(props: { pip?: boolean }) {
  const voice = useVoice();

  const trouble = () =>
    voice.state() === "RECONNECTING" || voice.state() === "DISCONNECTED";

  return (
    <Show when={trouble()}>
      <Status role="status" aria-live="polite" pip={props.pip}>
        <Symbol>
          {voice.state() === "DISCONNECTED"
            ? "wifi_tethering_error"
            : "wifi_tethering"}
        </Symbol>
        <Show
          when={voice.state() === "DISCONNECTED"}
          fallback={<Trans>Reconnecting</Trans>}
        >
          <Trans>Disconnected</Trans>
        </Show>
      </Status>
    </Show>
  );
}

/**
 * Shown while the browser won't play call audio until we interact (iOS)
 */
export function VoiceCallCardEnableAudio() {
  const voice = useVoice();

  return (
    <Show when={voice.audioBlocked()}>
      <EnableAudio onClick={() => voice.startAudio()}>
        <Symbol>volume_off</Symbol>
        <Trans>Tap to enable audio</Trans>
      </EnableAudio>
    </Show>
  );
}

const EnableAudio = styled("button", {
  base: {
    flexShrink: 0,
    zIndex: 1,
    alignSelf: "center",

    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    padding: "var(--gap-sm) var(--gap-md)",

    border: "none",
    borderRadius: "var(--borderRadius-full)",
    cursor: "pointer",
    font: "inherit",

    color: "var(--md-sys-color-on-error-container)",
    background: "var(--md-sys-color-error-container)",
  },
});

const Status = styled("div", {
  base: {
    flexShrink: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    color: "var(--md-sys-color-outline)",
  },
  variants: {
    pip: {
      true: {
        position: "absolute",
        insetInlineStart: "var(--gap-md)",
        top: "var(--gap-md)",
      },
    },
  },
});
