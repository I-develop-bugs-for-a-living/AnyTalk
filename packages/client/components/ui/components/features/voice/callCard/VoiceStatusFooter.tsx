import { Match, Show, Switch } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useNavigate } from "@revolt/routing";
import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { typography } from "@revolt/ui/components/design/Text";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { DeafenButton, LeaveCallButton, MuteButton } from "./VoiceCallButtons";

/**
 * Footer of the channel sidebars, shown only while in a voice call. Shows the
 * connection state, the voice channel (click to go there) and the mute,
 * deafen and leave buttons. It also holds the bottom safe area inset.
 */
export function VoiceStatusFooter() {
  const voice = useVoice();
  const state = useState();
  const navigate = useNavigate();
  const { t } = useLingui();

  return (
    <Show when={voice.channel()}>
      {(channel) => (
        <Footer role="region" aria-label={t`Voice connection`}>
          <Info>
            <Status
              role="status"
              trouble={
                voice.state() === "RECONNECTING" ||
                voice.state() === "DISCONNECTED"
              }
            >
              <Symbol size={16}>
                {voice.state() === "CONNECTED"
                  ? "graphic_eq"
                  : "wifi_tethering"}
              </Symbol>
              <Switch fallback={<Trans>Connected</Trans>}>
                <Match when={voice.state() === "CONNECTING"}>
                  <Trans>Connecting</Trans>
                </Match>
                <Match when={voice.state() === "RECONNECTING"}>
                  <Trans>Reconnecting</Trans>
                </Match>
                <Match when={voice.state() === "DISCONNECTED"}>
                  <Trans>Disconnected</Trans>
                </Match>
              </Switch>
            </Status>
            <ChannelLink
              type="button"
              onClick={() => {
                navigate(channel().path);
                // Show the content pane (slides the sidebar away) on phones
                state.appDrawer()?.setShown(true);
              }}
            >
              <Show when={channel().server}>
                {(server) => <>{server().name} / </>}
              </Show>
              {channel().name}
            </ChannelLink>
          </Info>
          <Buttons>
            <MuteButton size="sm" />
            <DeafenButton size="sm" />
            <LeaveCallButton size="sm" />
          </Buttons>
        </Footer>
      )}
    </Show>
  );
}

/** Pinned panel at the bottom of the sidebar, below the scrolling list */
const Footer = styled("div", {
  base: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px 12px",
    paddingBottom: "calc(8px + var(--safe-area-bottom))",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
  },
});

/** Status line and channel link */
const Info = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
});

/** Connection state line, red when the call is in trouble */
const Status = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    ...typography.raw({ class: "label", size: "small" }),
    color: "var(--md-sys-color-primary)",
  },
  variants: {
    trouble: {
      true: { color: "var(--md-sys-color-error)" },
    },
  },
});

/** Channel name button that opens the voice channel */
const ChannelLink = styled("button", {
  base: {
    minWidth: 0,
    minHeight: "24px",
    _phone: { minHeight: "44px" },
    padding: 0,
    border: "none",
    background: "none",
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    color: "var(--md-sys-color-on-surface)",

    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",

    _hover: { textDecoration: "underline" },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      borderRadius: "var(--borderRadius-xs)",
    },
  },
});

/** Row holding the mute, deafen and leave buttons */
const Buttons = styled("div", {
  base: {
    display: "flex",
    gap: "8px",
    justifyContent: "center",
    flexWrap: "wrap",
  },
});
