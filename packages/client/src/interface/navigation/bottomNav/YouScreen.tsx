import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { Text } from "@revolt/ui";

import { UserMenuItems } from "../servers/UserMenu";

/**
 * You tab of the phone bottom bar: the entries of the user menu (status,
 * custom status text, settings) as a screen instead of a popover.
 */
export function YouScreen() {
  const { t } = useLingui();

  return (
    <Surface role="region" aria-label={t`You`}>
      <Heading>
        <Text class="title" size="medium">
          <Trans>You</Trans>
        </Text>
      </Heading>
      <Scroller>
        {/* a plain list: ContextMenu would take the arrow, Tab and typing keys */}
        <Items role="group" aria-label={t`Account`}>
          {/* nothing to close on a screen */}
          <UserMenuItems onClose={() => {}} />
        </Items>
      </Scroller>
    </Surface>
  );
}

/**
 * Full-size surface of the screen
 */
const Surface = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-container-low)",
  },
});

/**
 * Title row, same height as the inbox header
 */
const Heading = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    paddingInline: "16px",
    paddingBlock: "8px",
    minHeight: "48px",
  },
});

/**
 * Scrolling area under the title
 */
const Scroller = styled("div", {
  base: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
  },
});

/**
 * Entries in a column, with the padding of the popover
 */
const Items = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: "8px",
    color: "var(--md-sys-color-on-surface)",
    fill: "var(--md-sys-color-on-surface)",
    userSelect: "none",
  },
});
