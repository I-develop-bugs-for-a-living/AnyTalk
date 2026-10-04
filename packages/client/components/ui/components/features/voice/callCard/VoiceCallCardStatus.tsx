import { Trans } from "@lingui/solid/macro";
import { Show } from "solid-js";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

export function VoiceCallCardStatus(props: { pip?: boolean }) {
  const voice = useVoice();

  const symbol = () => {
    switch (voice.state()) {
      case "CONNECTED":
        return "wifi_tethering";
      case "CONNECTING":
        return "wifi_tethering";
      case "DISCONNECTED":
        return "wifi_tethering_error";
      case "RECONNECTING":
        return "wifi_tethering";
      default:
        return "";
    }
  };

  const text = () => {
    switch (voice.state()) {
      case "CONNECTED":
        return <Trans>Connected</Trans>;
      case "CONNECTING":
        return <Trans>Connecting</Trans>;
      case "DISCONNECTED":
        return <Trans>Disconnected</Trans>;
      case "RECONNECTING":
        return <Trans>Reconnecting</Trans>;
      default:
        return null;
    }
  };

  return (
    <Status status={voice.state()} pip={props.pip}>
      <Symbol>{symbol()}</Symbol>{" "}
      <FadeOut fade={voice.state() === "CONNECTED"}>{text()}</FadeOut>
    </Status>
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

const FadeOut = styled("div", {
  base: {
    paddingInlineStart: "var(--gap-md)",
  },
  variants: {
    fade: {
      true: {
        opacity: 0,
        fontSize: 0,
        paddingInlineStart: 0,
        transition:
          "opacity .3s 5s ease, font-size .3s 6s, padding-inline-start .3s 6s",
      },
    },
  },
});

const Status = styled("div", {
  base: {
    flexShrink: 0,

    display: "flex",
    justifyContent: "center",
    zIndex: 1,

    _hover: {
      "& div": {
        opacity: 1,
        fontSize: "inherit",
        paddingInlineStart: "var(--gap-md)",
        transition:
          "opacity 0s 0s, font-size 0s 0s, padding-inline-start 0s 0s",
      },
    },
  },
  variants: {
    status: {
      READY: {},
      CONNECTED: {
        color: "var(--md-sys-color-primary)",
      },
      CONNECTING: {
        color: "var(--md-sys-color-outline)",
      },
      DISCONNECTED: {
        color: "var(--md-sys-color-outline)",
      },
      RECONNECTING: {
        color: "var(--md-sys-color-outline)",
      },
    },
    pip: {
      true: {
        position: "absolute",
        insetInlineStart: "var(--gap-md)",
        top: "var(--gap-md)",
      },
    },
  },
});
