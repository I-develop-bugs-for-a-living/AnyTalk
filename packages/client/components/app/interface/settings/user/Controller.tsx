import { For, JSX, Show } from "solid-js";

import { Trans } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { gamepadConnected } from "@revolt/gamepad";
import { useState } from "@revolt/state";
import { CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Game controller settings: turn controller support on or off, see whether a
 * controller is connected, and which button does what
 */
export function ControllerSettings() {
  const state = useState();

  /** Whether controller support is on (it is by default) */
  const enabled = () => state.settings.getValue("controller:enabled") ?? true;

  /** Buttons and what they do, named by position on the controller */
  const mapping: { button: JSX.Element; action: JSX.Element }[] = [
    {
      button: <Trans>D-pad or left stick</Trans>,
      action: <Trans>Move between buttons, menus and messages</Trans>,
    },
    {
      button: <Trans>A (bottom button)</Trans>,
      action: (
        <Trans>Press the selected item, or send in the message box</Trans>
      ),
    },
    {
      button: <Trans>B (right button)</Trans>,
      action: (
        <Trans>Go back: close a menu or dialog, leave the message box</Trans>
      ),
    },
    {
      button: <Trans>X (left button)</Trans>,
      action: <Trans>Open the context menu of the selected item</Trans>,
    },
    {
      button: <Trans>Y (top button)</Trans>,
      action: <Trans>Write a message</Trans>,
    },
    {
      button: <Trans>Left and right bumper</Trans>,
      action: <Trans>Previous and next channel</Trans>,
    },
    {
      button: <Trans>Left and right trigger</Trans>,
      action: <Trans>Previous and next server</Trans>,
    },
    {
      button: <Trans>Right stick</Trans>,
      action: <Trans>Scroll</Trans>,
    },
    {
      button: <Trans>View (back) button</Trans>,
      action: <Trans>Mute or unmute in a call</Trans>,
    },
    {
      button: <Trans>Menu (start) button</Trans>,
      action: (
        <Trans>Jump between servers, channels, messages and members</Trans>
      ),
    },
  ];

  return (
    <Column gap="lg">
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>sports_esports</Symbol>}
          action={<Checkbox checked={enabled()} />}
          onClick={() =>
            state.settings.setValue("controller:enabled", !enabled())
          }
          description={
            <Trans>
              Use a game controller to move around AnyTalk. Works with Xbox,
              PlayStation, Switch and Steam Deck controllers.
            </Trans>
          }
        >
          <Trans>Controller support</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Status role="status">
        <Symbol>{gamepadConnected() ? "check_circle" : "info"}</Symbol>
        <Text class="label">
          <Show
            when={gamepadConnected()}
            fallback={
              <Trans>
                No controller found. Connect one and press any button on it.
              </Trans>
            }
          >
            <Trans>A controller is connected.</Trans>
          </Show>
        </Text>
      </Status>

      <Column>
        <Text class="title">
          <Trans>Buttons</Trans>
        </Text>
        <Table>
          <caption class="visually-hidden">
            <Trans>What each controller button does</Trans>
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <Trans>Button</Trans>
              </th>
              <th scope="col">
                <Trans>Action</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={mapping}>
              {(row) => (
                <tr>
                  <th scope="row">{row.button}</th>
                  <td>{row.action}</td>
                </tr>
              )}
            </For>
          </tbody>
        </Table>
      </Column>
    </Column>
  );
}

const Status = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingInline: "16px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const Table = styled("table", {
  base: {
    width: "100%",
    borderCollapse: "collapse",
    color: "var(--md-sys-color-on-surface)",

    "& caption.visually-hidden": {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      whiteSpace: "nowrap",
    },

    "& th, & td": {
      textAlign: "start",
      paddingBlock: "8px",
      paddingInline: "12px",
      verticalAlign: "top",
      borderBlockEnd: "1px solid var(--md-sys-color-outline-variant)",
    },

    "& thead th": {
      color: "var(--md-sys-color-on-surface-variant)",
      fontWeight: 500,
    },

    "& tbody th": {
      fontWeight: 600,
      whiteSpace: "nowrap",
      _phone: { whiteSpace: "normal" },
    },
  },
});
