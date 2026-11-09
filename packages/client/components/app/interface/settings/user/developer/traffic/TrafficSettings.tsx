import {
  type JSX,
  For,
  Show,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { downloadFile } from "@revolt/common/lib/downloadFile";
import {
  type Destination,
  type DestinationType,
  buildHar,
  buildJson,
  clear,
  entries,
  fileStamp,
  formatBytes,
  recording,
  setRecording,
  setShowSecrets,
  showSecrets,
  summarizeDestinations,
} from "@revolt/traffic";
import {
  Button,
  CategoryButton,
  Checkbox,
  Column,
  Dialog,
  Text,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { useSettingsNavigation } from "../../../Settings";

/**
 * Settings, Developer, Network inspector: turn recording on, see where the
 * data goes, export what was recorded and open the live view.
 */
export function TrafficSettings() {
  const { t } = useLingui();
  const { navigate } = useSettingsNavigation();
  const [confirmSecrets, setConfirmSecrets] = createSignal(false);

  /** TLS key log state, desktop app only (missing in older versions) */
  const [keyLog, setKeyLog] =
    createSignal<
      Awaited<ReturnType<NonNullable<Window["native"]["getTlsKeyLog"]>>>
    >();
  /** The key log could not be read or changed */
  const [keyLogError, setKeyLogError] = createSignal(false);
  /** Whether this desktop app can write a TLS key log */
  const hasKeyLog = () => !!window.native?.getTlsKeyLog;

  onMount(async () => {
    try {
      setKeyLog(await window.native?.getTlsKeyLog?.());
    } catch (err) {
      console.error("[desktop] could not read the TLS key log state", err);
      setKeyLogError(true);
    }
  });

  /** Switch the key log on or off. The desktop app asks before switching on. */
  const toggleKeyLog = async () => {
    const current = keyLog();
    if (!current) return;
    try {
      const result = await window.native?.setTlsKeyLog?.(!current.enabled);
      if (result) setKeyLog(result);
      setKeyLogError(false);
    } catch (err) {
      console.error("[desktop] could not change the TLS key log", err);
      setKeyLogError(true);
    }
  };

  /** Show the key log file in the file manager. */
  const revealKeyLog = async () => {
    try {
      await window.native?.revealTlsKeyLog?.();
    } catch (err) {
      console.error("[desktop] could not show the TLS key log", err);
    }
  };

  const list = createMemo(() => entries({ showSecrets: showSecrets() }));
  const destinations = createMemo(() => summarizeDestinations(list()));

  /** Save the recorded entries as a file, timestamped. */
  const exportAs = (kind: "har" | "json") => {
    const data = kind === "har" ? buildHar(list()) : buildJson(list());
    downloadFile(
      JSON.stringify(data, null, 2),
      "application/json",
      `anytalk-traffic-${fileStamp()}.${kind}`,
    );
  };

  /** Turning secrets on asks first, turning them off does not. */
  const toggleSecrets = () => {
    if (showSecrets()) setShowSecrets(false);
    else setConfirmSecrets(true);
  };

  return (
    <Column gap="lg">
      <Text class="label">
        <Trans>
          The network inspector records what AnyTalk sends and receives, so you
          can check it against a tool like Wireshark. It is off by default and
          nothing is sent anywhere.
        </Trans>
      </Text>

      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>radio_button_checked</Symbol>}
          action={<Checkbox checked={recording()} />}
          onClick={() => setRecording(!recording())}
          description={
            <>
              {plural(list().length, { one: "# entry", other: "# entries" })}
              {" · "}
              <Trans>kept in memory only, gone when you reload</Trans>
            </>
          }
        >
          <Trans>Record network traffic</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>key</Symbol>}
          action={<Checkbox checked={showSecrets()} />}
          onClick={toggleSecrets}
          description={
            <Trans>
              Off: tokens, passwords and keys are hidden. Resets when you
              reload.
            </Trans>
          }
        >
          <Trans>Show tokens and keys</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Buttons>
        <Button
          variant="filled"
          onPress={() => navigate("developer/traffic/live")}
        >
          <Trans>Open live view</Trans>
        </Button>
        <Button
          variant="tonal"
          isDisabled={list().length === 0}
          onPress={() => exportAs("har")}
        >
          <Trans>Export HAR</Trans>
        </Button>
        <Button
          variant="tonal"
          isDisabled={list().length === 0}
          onPress={() => exportAs("json")}
        >
          <Trans>Export JSON</Trans>
        </Button>
        <ErrorText>
          <Button
            variant="text"
            isDisabled={list().length === 0}
            onPress={clear}
          >
            <Trans>Clear</Trans>
          </Button>
        </ErrorText>
      </Buttons>

      <Show when={hasKeyLog()}>
        <Column gap="md">
          <Text class="title">
            <Trans>TLS key log</Trans>
          </Text>
          <CategoryButton.Group>
            <CategoryButton
              icon={<Symbol>vpn_key</Symbol>}
              action={<Checkbox checked={keyLog()?.enabled ?? false} />}
              onClick={toggleKeyLog}
              description={
                <Show
                  when={keyLog()}
                  fallback={<Trans>Could not read the key log state.</Trans>}
                >
                  {(state) => (
                    <Show
                      when={state().active}
                      fallback={
                        <Show
                          when={state().enabled}
                          fallback={<Trans>Off</Trans>}
                        >
                          <Trans>Turns on after restart</Trans>
                        </Show>
                      }
                    >
                      <Show
                        when={state().enabled}
                        fallback={<Trans>Turns off after restart</Trans>}
                      >
                        <Trans>Active, writing to {state().path}</Trans>
                      </Show>
                    </Show>
                  )}
                </Show>
              }
            >
              <Trans>Write TLS keys to a file</Trans>
            </CategoryButton>
          </CategoryButton.Group>
          <Show when={keyLogError()}>
            <ErrorLine role="alert">
              <Trans>Could not change the key log. Try again.</Trans>
            </ErrorLine>
          </Show>
          <Buttons>
            <Button
              variant="tonal"
              isDisabled={!keyLog()?.exists}
              onPress={revealKeyLog}
            >
              <Trans>Show file</Trans>
            </Button>
          </Buttons>
          <Text class="label">
            <Trans>
              Call encryption (DTLS-SRTP) keys are not in this file, so call
              media stays unreadable in Wireshark even with it.
            </Trans>
          </Text>
        </Column>
      </Show>

      <Column>
        <Text class="title">
          <Trans>Where your data goes</Trans>
        </Text>
        <Show
          when={destinations().length}
          fallback={
            <Empty>
              <Symbol size={48}>public</Symbol>
              <strong>
                <Trans>Nothing to show yet</Trans>
              </strong>
              <span>
                <Show
                  when={recording()}
                  fallback={
                    <Trans>
                      Turn on recording to see which servers the app talks to.
                    </Trans>
                  }
                >
                  <Trans>
                    Servers show up here as soon as the app talks to them.
                  </Trans>
                </Show>
              </span>
            </Empty>
          }
        >
          <Destinations aria-label={t`Servers contacted`}>
            <For each={destinations()}>
              {(row) => <DestinationRow row={row} />}
            </For>
          </Destinations>
        </Show>
      </Column>

      <Section summary={<Trans>Calls: how they are encrypted</Trans>}>
        <p>
          <Trans>
            Inside: end-to-end encryption (LiveKit E2EE) with a key only the
            people in the call hold. The media server forwards frames it cannot
            read.
          </Trans>
        </p>
        <p>
          <Trans>
            Outside: SRTP over DTLS between your device and the media server, as
            for any WebRTC call.
          </Trans>
        </p>
        <p>
          <Trans>
            A packet capture (for example Wireshark) therefore shows only
            DTLS/SRTP ciphertext, and the media server only sees end-to-end
            ciphertext.
          </Trans>
        </p>
        <p>
          <Trans>
            Data messages and participant attributes (who watches a stream,
            deafened, key exchange) go over the signalling WebSocket to the
            media server. They are not end-to-end encrypted, but the key
            exchange only carries public keys and keys wrapped for one
            recipient.
          </Trans>
        </p>
      </Section>

      <Section summary={<Trans>Inspect with Wireshark</Trans>}>
        <p>
          <Trans>
            Without the keys, Wireshark only sees encrypted TLS and DTLS
            traffic. What it can still tell you is where the data goes and how
            much. Compare that with the servers and sizes listed above.
          </Trans>
        </p>
        <Show
          when={window.native}
          fallback={
            <p>
              <Trans>
                In the browser, export the HAR file and open it in your
                browser's developer tools (Network tab, import) or another HAR
                viewer to see the requests in detail.
              </Trans>
            </p>
          }
        >
          <p>
            <Trans>
              In the desktop app, switch on "Write TLS keys to a file" above and
              restart the app. Then start a capture in Wireshark, use the app,
              and open Edit, Preferences, Protocols, TLS. Set
              "(Pre)-Master-Secret log filename" to the file shown above (use
              "Show file" to find it). Wireshark then decrypts the HTTPS and WSS
              traffic.
            </Trans>
          </p>
          <p>
            <Trans>
              Anyone who gets the key log file and a capture can read the
              traffic, so switch it off when you are done. It also switches off
              when the app updates. Calls stay unreadable: their media keys are
              not in this file.
            </Trans>
          </p>
          <p>
            <Trans>
              Requests from images, fonts and other files, and from the app
              itself rather than a page, are listed too, marked "Desktop app".
              They are only recorded while recording is on.
            </Trans>
          </p>
        </Show>
      </Section>

      {/* only mount while open: a closed Dialog still covers the window and swallows clicks */}
      <Show when={confirmSecrets()}>
        <Dialog
          show
          onClose={() => setConfirmSecrets(false)}
          title={<Trans>Show tokens and keys?</Trans>}
          actions={[
            { text: <Trans>Cancel</Trans> },
            { text: <Trans>Show</Trans>, onClick: () => setShowSecrets(true) },
          ]}
        >
          <Trans>
            Session tokens, passwords and call keys will appear on screen and in
            exports. Anyone who sees or gets them could sign in as you. Turn
            this on only to debug, and don't share the exports.
          </Trans>
        </Dialog>
      </Show>
    </Column>
  );
}

/** Display name of a destination type. */
function useTypeLabel() {
  const { t } = useLingui();
  return (type: DestinationType) =>
    ({
      https: "HTTPS",
      http: "HTTP",
      wss: "WSS",
      ws: "WS",
      call: t`Call`,
      files: t`Files`,
    })[type];
}

/**
 * One row of the destinations: host, type, count and size.
 */
function DestinationRow(props: { row: Destination }) {
  const typeLabel = useTypeLabel();
  return (
    <li>
      <code>{props.row.host}</code>
      <span>{typeLabel(props.row.type)}</span>
      <span>{props.row.count}</span>
      <span>{formatBytes(props.row.bytes)}</span>
    </li>
  );
}

/**
 * A collapsible section with a heading.
 */
function Section(props: { summary: JSX.Element; children: JSX.Element }) {
  return (
    <Details>
      <summary>{props.summary}</summary>
      <div>{props.children}</div>
    </Details>
  );
}

/** The action buttons, wrapping on narrow screens */
const Buttons = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" },
});

/** Error message under a setting */
const ErrorLine = styled("p", {
  base: {
    margin: 0,
    fontSize: "13px",
    color: "var(--md-sys-color-error)",
  },
});

/** Makes the text button inside use the error color */
const ErrorText = styled("div", {
  base: { "& button": { color: "var(--md-sys-color-error)" } },
});

/** The list of servers */
const Destinations = styled("ul", {
  base: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container)",
    overflow: "hidden",

    "& li": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) 64px 48px 72px",
      alignItems: "center",
      columnGap: "12px",
      minHeight: "44px",
      paddingInline: "16px",
      fontSize: "13px",
      color: "var(--md-sys-color-on-surface)",
      borderBlockEnd: "1px solid var(--md-sys-color-outline-variant)",
    },
    "& li:last-child": { borderBlockEnd: "none" },
    "& code": {
      minWidth: 0,
      overflowWrap: "anywhere",
      fontFamily: "var(--fonts-monospace, monospace)",
    },
    "& li > span:nth-of-type(n+2)": { textAlign: "end" },
    "& li > span:first-of-type": {
      color: "var(--md-sys-color-on-surface-variant)",
    },
  },
});

/** Centred empty state */
const Empty = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",

    "& strong": { fontSize: "16px", color: "var(--md-sys-color-on-surface)" },
    "& span": { fontSize: "13px" },
  },
});

/** Collapsible section */
const Details = styled("details", {
  base: {
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",

    "& summary": {
      display: "flex",
      alignItems: "center",
      minHeight: "44px",
      paddingInline: "16px",
      cursor: "pointer",
      fontWeight: 600,
      borderRadius: "var(--borderRadius-md)",

      _focusVisible: {
        outline: "2px solid var(--md-sys-color-primary)",
        outlineOffset: "-2px",
      },
    },
    "& > div": {
      padding: "0 16px 12px",
      fontSize: "14px",
      lineHeight: 1.5,
    },
    "& p": { margin: "0 0 10px" },
  },
});
