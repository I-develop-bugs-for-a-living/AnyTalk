import { type JSX, For, Match, Show, Switch, createMemo } from "solid-js";

import { Plural, Trans, useLingui } from "@lingui/solid/macro";
import type { Channel, User } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useModals } from "@revolt/modal";
import { useNavigate } from "@revolt/routing";
import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { clampRecentCallsShown } from "@revolt/state/stores/recentCalls";
import { Avatar, Button, Text, UserStatus } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  collectFriendsInCalls,
  collectOnlineFriends,
  groupByKey,
  pickRecentCalls,
} from "./friendsOverview";

/**
 * Where a call is, e.g. "General · My server" or the name of a group
 */
function channelLabel(channel: Channel) {
  const server = channel.server;
  return server
    ? `${channel.name} · ${server.name}`
    : (channel.displayName ?? channel.name);
}

/**
 * Name of a channel inside its card: the channel, or the DM or group
 */
function channelName(channel: Channel) {
  return channel.server ? channel.name : (channel.displayName ?? channel.name);
}

/**
 * Key of the card a call belongs to: its server, or the DM or group itself
 */
function cardKey(channel: Channel) {
  return channel.serverId ?? channel.id;
}

/**
 * Card for calls in one server (or one DM or group), with the icon and name
 * as its heading and the rows as a list
 */
function CallCard(props: {
  /** Any channel of the card, used for the icon and name */
  channel: Channel;
  id: string;
  children: JSX.Element;
}) {
  return (
    <Card aria-labelledby={props.id}>
      <CardHeader id={props.id}>
        <Avatar
          size={24}
          src={
            props.channel.server?.animatedIconURL ??
            props.channel.animatedIconURL ??
            props.channel.recipient?.animatedAvatarURL
          }
          fallback={
            props.channel.server?.name ??
            props.channel.displayName ??
            props.channel.name
          }
        />
        <Ellipsis>
          {props.channel.server?.name ??
            props.channel.displayName ??
            props.channel.name}
        </Ellipsis>
      </CardHeader>
      <RowList>{props.children}</RowList>
    </Card>
  );
}

/**
 * Overview of friends on the home page: friends in calls, recently joined
 * calls and the other friends who are online.
 */
export function FriendsOverview() {
  const client = useClient();
  const navigate = useNavigate();
  const voice = useVoice();
  const state = useState();
  const { openModal } = useModals();
  const { t } = useLingui();

  /** All friends of the current user */
  const friends = createMemo(() =>
    client()
      .users.toList()
      .filter((user) => user.relationship === "Friend"),
  );

  /** Voice channels that currently have people in them */
  const activeCalls = createMemo(() =>
    client()
      .channels.toList()
      .filter((channel) => channel.isVoice && channel.voiceParticipants.size)
      .map((channel) => ({
        channel,
        channelId: channel.id,
        userIds: [...channel.voiceParticipants.values()].map((p) => p.userId),
      })),
  );

  /** Online friends in a call */
  const inCall = createMemo(() =>
    collectFriendsInCalls(friends(), activeCalls()),
  );

  /**
   * Friends in a call other than the current user's own call. Friends in
   * the user's call are left out completely (also from "Online").
   */
  const otherCalls = createMemo(() => {
    const current = voice.channel()?.id;
    return inCall().filter((entry) => entry.call.channelId !== current);
  });

  /** Friends in a call, grouped into one card per server */
  const inCallCards = createMemo(() =>
    groupByKey(otherCalls(), (entry) => cardKey(entry.call.channel)),
  );

  /**
   * Recent calls that aren't already listed under a friend or the current
   * call. The chosen number is applied after hiding, so the list fills up.
   */
  const recent = createMemo(() => {
    const hidden = new Set(inCall().map((entry) => entry.call.channelId));
    const current = voice.channel()?.id;
    if (current) hidden.add(current);
    return pickRecentCalls(
      state.voice.getRecentCalls(),
      (id) => {
        const channel = client().channels.get(id);
        return !!channel?.isVoice && channel.havePermission("ViewChannel");
      },
      hidden,
      clampRecentCallsShown(
        state.settings.getValue("advanced:recent_calls_shown"),
      ),
    ).map((id) => client().channels.get(id)!);
  });

  /** Recent calls, one card per server */
  const recentCards = createMemo(() =>
    groupByKey(recent(), (channel) => cardKey(channel)),
  );

  /** Other online friends */
  const online = createMemo(() =>
    collectOnlineFriends(
      friends(),
      new Set(inCall().map((entry) => entry.friend.id)),
    ),
  );

  /**
   * Open and join the call in a channel. When already in another call this
   * switches to the new one without asking: that is intentional.
   */
  const join = (channel: Channel) => {
    navigate(channel.path);
    voice.connect(channel);
  };

  /** Open a direct message with a user, showing an error if it fails */
  const openDm = (user: User) =>
    user
      .openDM()
      .then((channel) => navigate(channel.path))
      .catch((error) => openModal({ type: "error2", error }));

  /** Join button, "Switch" when in another call, "In call" when already here */
  const JoinButton = (props: { channel: Channel }) => {
    const name = () => channelLabel(props.channel);
    const switching = () => {
      const current = voice.channel();
      return !!current && current.id !== props.channel.id;
    };

    return (
      <Show when={props.channel.havePermission("Connect")}>
        <ButtonSlot>
          <Show
            when={voice.channel()?.id !== props.channel.id}
            fallback={
              <Button
                variant="text"
                size="sm"
                onPress={() => navigate(props.channel.path)}
              >
                <Trans>In call</Trans>
              </Button>
            }
          >
            <Button
              variant="tonal"
              size="sm"
              aria-label={
                switching()
                  ? (() => {
                      const label = name();
                      return t`Switch to ${label}`;
                    })()
                  : (() => {
                      const label = name();
                      return t`Join ${label}`;
                    })()
              }
              onPress={() => join(props.channel)}
            >
              <Show when={switching()} fallback={<Trans>Join</Trans>}>
                <Trans>Switch</Trans>
              </Show>
            </Button>
          </Show>
        </ButtonSlot>
      </Show>
    );
  };

  /** Custom status text, or the label of the presence */
  const statusText = (user: User) => {
    const custom = user.status?.text;
    if (custom) return custom;
    switch (user.presence) {
      case "Busy":
        return t`Busy`;
      case "Idle":
        return t`Idle`;
      case "Focus":
        return t`Focus`;
      default:
        return t`Online`;
    }
  };

  /** Friend avatar with presence dot */
  const FriendAvatar = (props: { user: User }) => (
    <Avatar
      size={40}
      src={props.user.animatedAvatarURL}
      fallback={props.user.displayName}
      holepunch="bottom-right"
      overlay={<UserStatus.Graphic status={props.user.presence} />}
    />
  );

  return (
    <Root>
      <Switch>
        <Match when={!inCall().length && !recent().length && !online().length}>
          <Empty>
            <Symbol size={48}>group_off</Symbol>
            <Text class="title">
              <Trans>None of your friends are online</Trans>
            </Text>
            <Text class="body">
              <Trans>Friends who are online or in a call show up here.</Trans>
            </Text>
            <Button
              variant="tonal"
              size="sm"
              onPress={() => navigate("/friends")}
            >
              <Trans>Open friends</Trans>
            </Button>
          </Empty>
        </Match>
        <Match when={true}>
          <Show when={otherCalls().length}>
            <Section aria-labelledby="overview-in-call">
              <Heading id="overview-in-call">
                <Text class="label" size="large">
                  {(() => {
                    const count = otherCalls().length;
                    return <Trans>In a call · {count}</Trans>;
                  })()}
                </Text>
              </Heading>
              <For each={inCallCards()}>
                {(group) => (
                  <CallCard
                    channel={group.items[0].call.channel}
                    id={`overview-call-${group.key}`}
                  >
                    <For each={group.items}>
                      {(entry) => (
                        <Row>
                          <RowMain
                            type="button"
                            onClick={() => navigate(entry.call.channel.path)}
                          >
                            <FriendAvatar user={entry.friend} />
                            <RowText>
                              <Ellipsis>{entry.friend.displayName}</Ellipsis>
                              <Sub>
                                <Symbol size={16}>volume_up</Symbol>
                                <Ellipsis>
                                  {channelName(entry.call.channel)}
                                </Ellipsis>
                                <Show when={entry.others}>
                                  <Others>
                                    {"· "}
                                    <Plural
                                      value={entry.others}
                                      one="+# other"
                                      other="+# others"
                                    />
                                  </Others>
                                </Show>
                              </Sub>
                            </RowText>
                          </RowMain>
                          <JoinButton channel={entry.call.channel} />
                        </Row>
                      )}
                    </For>
                  </CallCard>
                )}
              </For>
            </Section>
          </Show>

          <Show when={recent().length}>
            <Section aria-labelledby="overview-recent">
              <Heading id="overview-recent">
                <Text class="label" size="large">
                  <Trans>Recent calls</Trans>
                </Text>
              </Heading>
              <For each={recentCards()}>
                {(group) => (
                  <CallCard
                    channel={group.items[0]}
                    id={`overview-recent-${group.key}`}
                  >
                    <For each={group.items}>
                      {(channel) => (
                        <Row>
                          <RowMain
                            type="button"
                            onClick={() => navigate(channel.path)}
                          >
                            <IconCircle>
                              <Symbol>volume_up</Symbol>
                            </IconCircle>
                            <RowText>
                              <Ellipsis>{channelName(channel)}</Ellipsis>
                              <Sub>
                                <Ellipsis>
                                  <Show
                                    when={channel.voiceParticipants.size}
                                    fallback={<Trans>Empty</Trans>}
                                  >
                                    <Plural
                                      value={channel.voiceParticipants.size}
                                      one="# person in the call"
                                      other="# people in the call"
                                    />
                                  </Show>
                                </Ellipsis>
                              </Sub>
                            </RowText>
                          </RowMain>
                          <JoinButton channel={channel} />
                        </Row>
                      )}
                    </For>
                  </CallCard>
                )}
              </For>
            </Section>
          </Show>

          <Show when={online().length}>
            <Section aria-labelledby="overview-online">
              <Heading id="overview-online">
                <Text class="label" size="large">
                  {(() => {
                    const count = online().length;
                    return <Trans>Online · {count}</Trans>;
                  })()}
                </Text>
              </Heading>
              <RowList>
                <For each={online()}>
                  {(user) => {
                    const name = user.displayName;
                    return (
                      <Row>
                        {/* one tab stop: the whole row opens the DM, the chat
                            icon is only a visual cue */}
                        <RowMain
                          type="button"
                          aria-label={t`Send a message to ${name}`}
                          onClick={() => openDm(user)}
                        >
                          <FriendAvatar user={user} />
                          <RowText>
                            <Ellipsis>{user.displayName}</Ellipsis>
                            <Sub>
                              <Ellipsis>{statusText(user)}</Ellipsis>
                            </Sub>
                          </RowText>
                          <Symbol aria-hidden="true">chat</Symbol>
                        </RowMain>
                      </Row>
                    );
                  }}
                </For>
              </RowList>
            </Section>
          </Show>
        </Match>
      </Switch>
    </Root>
  );
}

/**
 * Wraps a row's action button and makes sure it is at least 44px tall
 */
const ButtonSlot = styled("span", {
  base: {
    flexShrink: 0,
    display: "flex",
    "& > button": {
      minHeight: "44px",
    },
  },
});

/**
 * "+N others" text that stays visible when the channel name is cut off
 */
const Others = styled("span", {
  base: {
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
});

/**
 * Container, one column that never grows wider than the page
 */
const Root = styled("div", {
  base: {
    width: "100%",
    maxWidth: "560px",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    paddingInline: "16px",
    boxSizing: "border-box",
  },
});

/**
 * One group of rows
 */
const Section = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
});

/**
 * Group heading
 */
const Heading = styled("h2", {
  base: {
    margin: 0,
    paddingInline: "12px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * List of rows
 */
const RowList = styled("ul", {
  base: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
});

/**
 * One card per server
 */
const Card = styled("section", {
  base: {
    minWidth: 0,
    overflow: "hidden",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container-low)",
    color: "var(--md-sys-color-on-surface)",
  },
});

/**
 * Card heading with the server icon and name
 */
const CardHeader = styled("h3", {
  base: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
    padding: "12px 16px 4px",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * A row: the main button and an optional action next to it
 */
const Row = styled("li", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
    minHeight: "56px",
    paddingInlineEnd: "8px",
    borderRadius: "var(--borderRadius-md)",
    color: "var(--md-sys-color-on-surface)",

    // thin divider between rows of a card
    "& + li": {
      borderBlockStart: "1px solid var(--md-sys-color-outline-variant)",
      borderStartStartRadius: 0,
      borderStartEndRadius: 0,
    },

    _hover: {
      background: "var(--md-sys-color-surface-container)",
    },
  },
});

/**
 * Clickable part of a row
 */
const RowMain = styled("button", {
  base: {
    flex: 1,
    minWidth: 0,
    minHeight: "56px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    borderRadius: "var(--borderRadius-md)",
  },
});

/**
 * Text lines of a row
 */
const RowText = styled("span", {
  base: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
});

/**
 * Single line of text that is cut off with an ellipsis
 */
const Ellipsis = styled("span", {
  base: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});

/**
 * Secondary line of a row
 */
const Sub = styled("span", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minWidth: 0,
    fontSize: "0.8125rem",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * Round background for an icon in place of an avatar
 */
const IconCircle = styled("span", {
  base: {
    width: "40px",
    height: "40px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--borderRadius-circle)",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
  },
});

/**
 * Quiet empty state
 */
const Empty = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    padding: "16px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
