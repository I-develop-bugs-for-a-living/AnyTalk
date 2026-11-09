import { For, JSX, Show, createMemo } from "solid-js";

import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useClient, useUser } from "@revolt/client";
import {
  PHONE_TABS,
  PhoneTab,
  countIncomingRequests,
  countUnreadConversations,
  formatBadgeCount,
  summarizeServers,
} from "@revolt/common/lib/phoneTabs";
import { useState } from "@revolt/state";
import { Avatar, Symbol, UserStatus, typography } from "@revolt/ui";

interface Props {
  /**
   * Tab that is open
   */
  active: PhoneTab;

  /**
   * Number of unread mentions in the inbox
   */
  inboxCount: number;

  /**
   * A tab was tapped
   * @param tab Tab that was tapped
   * @param repeated Whether it was the open tab already
   */
  onSelect: (tab: PhoneTab, repeated: boolean) => void;
}

/**
 * Bottom navigation bar of the phone layout (Material 3 navigation bar): five
 * tabs with a label, a pill behind the icon of the open one and badges for
 * what needs attention. It sits below the list screens only; chats cover it.
 */
export function BottomNav(props: Props) {
  const { t } = useLingui();
  const client = useClient();
  const user = useUser();
  const state = useState();

  /** Incoming friend requests, shown on Home */
  const requests = createMemo(() => countIncomingRequests(client().users));

  /** Unread direct messages and groups, shown on Messages */
  const unreadMessages = createMemo(() =>
    countUnreadConversations(
      state.ordering
        .orderedConversations(client())
        .map((channel) => ({ unread: channel.unread, muted: channel.muted })),
    ),
  );

  /** Mentions or a plain unread mark across servers, shown on Servers */
  const serverBadge = createMemo(() =>
    summarizeServers(
      state.ordering.orderedServers(client()).map((server) => ({
        unread: server.unread,
        muted: state.notifications.isMuted(server),
        mentions: server.mentions.length,
      })),
    ),
  );

  /** Own presence as text, for the You tab's label */
  const presence = () => {
    switch (user()?.presence) {
      case "Online":
        return t`Online`;
      case "Busy":
        return t`Busy`;
      case "Focus":
        return t`Focus`;
      case "Idle":
        return t`Idle`;
      case "Invisible":
        return t`Invisible`;
      default:
        return t`Offline`;
    }
  };

  /**
   * Visible label of a tab
   * @param tab Tab
   */
  const label = (tab: PhoneTab) => {
    switch (tab) {
      case "home":
        return t`Home`;
      case "messages":
        return t`Messages`;
      case "servers":
        return t`Servers`;
      case "inbox":
        return t`Inbox`;
      case "you":
        return t`You`;
    }
  };

  /**
   * Number shown on a tab's badge, 0 for none
   * @param tab Tab
   */
  const count = (tab: PhoneTab) => {
    switch (tab) {
      case "home":
        return requests();
      case "messages":
        return unreadMessages();
      case "servers":
        return serverBadge().mentions;
      case "inbox":
        return props.inboxCount;
      default:
        return 0;
    }
  };

  /**
   * Screen reader text of a tab: the label plus what the badge says
   * @param tab Tab
   */
  const ariaLabel = (tab: PhoneTab) => {
    const n = count(tab);
    switch (tab) {
      case "home":
        return n > 0
          ? plural(n, {
              one: "Home, # pending friend request",
              other: "Home, # pending friend requests",
            })
          : t`Home`;
      case "messages":
        return n > 0
          ? plural(n, {
              one: "Messages, # unread",
              other: "Messages, # unread",
            })
          : t`Messages`;
      case "servers":
        return n > 0
          ? plural(n, {
              one: "Servers, # unread mention",
              other: "Servers, # unread mentions",
            })
          : serverBadge().dot
            ? t`Servers, unread messages`
            : t`Servers`;
      case "inbox":
        return n > 0
          ? plural(n, {
              one: "Inbox, # unread mention",
              other: "Inbox, # unread mentions",
            })
          : t`Inbox`;
      case "you":
        return t`You, ${presence()}`;
    }
  };

  /**
   * Icon of a tab, filled while it is open
   * @param tab Tab
   */
  const icon = (tab: PhoneTab): JSX.Element => {
    const active = props.active === tab;
    switch (tab) {
      case "home":
        return <Symbol fill={active}>home</Symbol>;
      case "messages":
        return <Symbol fill={active}>chat</Symbol>;
      case "servers":
        return <Symbol fill={active}>groups</Symbol>;
      case "inbox":
        return <Symbol fill={active}>inbox</Symbol>;
      case "you":
        return (
          <Avatar
            size={24}
            src={user()?.avatarURL}
            fallback={user()?.displayName ?? user()?.username}
            holepunch="bottom-right"
            overlay={<UserStatus.Graphic status={user()?.presence} />}
          />
        );
    }
  };

  return (
    <Bar aria-label={t`Main navigation`} data-bottom-nav>
      <For each={PHONE_TABS}>
        {(tab) => (
          <TabButton
            type="button"
            aria-label={ariaLabel(tab)}
            aria-current={props.active === tab ? "true" : undefined}
            onClick={() => props.onSelect(tab, props.active === tab)}
          >
            <IconPill active={props.active === tab}>
              {icon(tab)}
              <Show when={count(tab) > 0}>
                <CountBadge aria-hidden="true">
                  {formatBadgeCount(count(tab))}
                </CountBadge>
              </Show>
              <Show when={tab === "servers" && serverBadge().dot}>
                <DotBadge aria-hidden="true" />
              </Show>
            </IconPill>
            <TabLabel aria-hidden="true">{label(tab)}</TabLabel>
          </TabButton>
        )}
      </For>
    </Bar>
  );
}

/**
 * The bar: surface container colour, 64px plus the home indicator inset
 */
const Bar = styled("nav", {
  base: {
    display: "flex",
    flexShrink: 0,
    alignItems: "stretch",
    minHeight: "64px",
    paddingBlockEnd: "var(--safe-area-bottom)",
    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-container)",
  },
});

/**
 * One tab: icon above label, takes an equal share of the bar
 */
const TabButton = styled("button", {
  base: {
    flex: "1 1 0",
    minWidth: 0,
    minHeight: "64px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    paddingBlock: "12px 16px",
    paddingInline: "4px",
    border: 0,
    background: "none",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },

    "&[aria-current=true]": {
      color: "var(--md-sys-color-on-surface)",
    },
  },
});

/**
 * Pill behind the icon, filled with the secondary container while open
 */
const IconPill = styled("span", {
  base: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "64px",
    height: "32px",
    flexShrink: 0,
    borderRadius: "var(--borderRadius-full)",
    background: "transparent",
    transition: "var(--transitions-medium) background",

    "@media (prefers-reduced-motion: reduce)": {
      transition: "none",
    },
  },
  variants: {
    active: {
      true: {
        color: "var(--md-sys-color-on-secondary-container)",
        background: "var(--md-sys-color-secondary-container)",
      },
    },
  },
});

/**
 * Label under the icon, shrinks with an ellipsis for long translations
 */
const TabLabel = styled("span", {
  base: {
    ...typography.raw({ class: "label", size: "medium" }),
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "center",
  },
});

/**
 * Number badge on the corner of the icon
 */
const CountBadge = styled("span", {
  base: {
    ...typography.raw({ class: "label", size: "small" }),
    position: "absolute",
    insetBlockStart: "-2px",
    insetInlineStart: "calc(50% + 4px)",
    minWidth: "16px",
    height: "16px",
    paddingInline: "4px",
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    fontSize: "11px",
    lineHeight: 1,
    borderRadius: "var(--borderRadius-full)",
    color: "var(--md-sys-color-on-error)",
    background: "var(--md-sys-color-error)",
  },
});

/**
 * Small dot for unread messages without a count
 */
const DotBadge = styled("span", {
  base: {
    position: "absolute",
    insetBlockStart: "2px",
    insetInlineStart: "calc(50% + 6px)",
    width: "8px",
    height: "8px",
    borderRadius: "var(--borderRadius-circle)",
    background: "var(--md-sys-color-error)",
  },
});
