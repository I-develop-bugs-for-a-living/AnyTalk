import { createMemo, Match, Show, Switch } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import MdChevronRight from "@material-design-icons/svg/filled/chevron_right.svg?component-solid";
import { VirtualContainer } from "@minht11/solid-virtual-container";
import { Channel, ServerMember, User } from "stoat.js";
import { styled } from "styled-system/jsx";

import { floatingUserMenus } from "@revolt/app/menus/UserContextMenu";
import { useClient } from "@revolt/client";
import { createIsTimedOut } from "@revolt/common/lib/createIsTimedOut";
import { TextWithEmoji } from "@revolt/markdown";
import { userInformation } from "@revolt/markdown/users";
import { useState } from "@revolt/state";
import {
  Avatar,
  Deferred,
  iconSize,
  MenuButton,
  OverflowingText,
  Row,
  Symbol,
  Tooltip,
  typography,
  Username,
  UserStatus,
} from "@revolt/ui";

interface Props {
  /**
   * Channel
   */
  channel: Channel;

  /**
   * Scroll target element
   */
  scrollTargetElement: HTMLDivElement;

  /**
   * Whether the server is very large and should not display all member information
   */
  isLargeServer?: boolean;
}

/**
 * Member Sidebar
 */
export function MemberSidebar(props: Props) {
  return (
    <Switch>
      <Match when={props.channel.type === "Group"}>
        <GroupMemberSidebar
          channel={props.channel}
          scrollTargetElement={props.scrollTargetElement}
        />
      </Match>
      <Match when={props.channel.type === "TextChannel"}>
        <ServerMemberSidebar
          channel={props.channel}
          scrollTargetElement={props.scrollTargetElement}
          isLargeServer={props.isLargeServer}
        />
      </Match>
    </Switch>
  );
}

/**
 * Server Member Sidebar
 */
export function ServerMemberSidebar(props: Props) {
  const client = useClient();
  const { t } = useLingui();
  const state = useState();

  type MemberRoleElement =
    | {
        t: 0;
        id: string;
        open: boolean;
        name: string;
        count: number;
        icon?: string | null;
      }
    | { t: 1; member: ServerMember; icon?: never; isOnline: boolean };

  /**
   * Section state key of a member group, remembered per server
   */
  const groupKey = (groupId: string) =>
    `members:${props.channel.serverId}:${groupId}`;

  /**
   * All groups and their members, ignoring collapsed state
   */
  const allElements = createMemo(() => {
    const hoistedRoles = props.channel.server!.orderedRoles.filter(
      (role) => role.hoist,
    );

    const restricted = props.channel.potentiallyRestrictedChannel;
    const byRole: Map<string, { member: ServerMember; displayName: string }[]> =
      new Map();
    byRole.set("default", []);
    byRole.set("offline", []);
    hoistedRoles.forEach((role) => byRole.set(role.id, []));

    for (const member of client().serverMembers.values()) {
      if (member.id.server !== props.channel.serverId) {
        continue;
      }
      // If the channel is restricted, check for permission
      if (restricted && !member.hasPermission(props.channel, "ViewChannel")) {
        continue;
      }

      // Only hit the store once to reduce watchers.
      // If you need to access anything on the member in a loop define a const here.
      const memberRoles = member.roles;
      const memberName = member.nickname ?? member.user?.displayName ?? "";

      if (!member.user?.online) {
        byRole.get("offline")!.push({
          member,
          displayName: memberName,
        });
        continue;
      }

      if (memberRoles.length) {
        let assigned;
        for (const hoistedRole of hoistedRoles) {
          if (memberRoles.includes(hoistedRole.id)) {
            byRole.get(hoistedRole.id)!.push({
              member,
              displayName: memberName,
            });
            assigned = true;
            break;
          }
        }

        if (assigned) continue;
      }

      byRole.get("default")!.push({
        member,
        displayName: memberName,
      });
    }

    const roles: { id: string; name: string; icon?: string }[] = [];

    const elements: MemberRoleElement[] = [];

    for (const role of hoistedRoles) {
      roles.push({
        id: role.id,
        name: role.name,
        icon: role.icon?.previewUrl,
      });
    }
    roles.push({ id: "default", name: t`Online` });
    roles.push({ id: "offline", name: t`Offline` });

    for (const role of roles) {
      const roleMembers = byRole
        .get(role.id)!
        .sort((a, b) => a.displayName?.localeCompare(b.displayName) || 0);

      if (!roleMembers?.length) {
        continue;
      }

      elements.push({
        t: 0,
        id: role.id,
        open: true,
        name: role.name,
        icon: role.icon,
        count: roleMembers.length,
      });

      for (const member of roleMembers) {
        elements.push({
          t: 1,
          member: member.member,
          isOnline: role.id !== "offline",
        });
      }
    }

    return elements;
  });

  /**
   * Elements to display: headers stay, members of collapsed groups are skipped
   */
  const elements = createMemo(() => {
    const result: MemberRoleElement[] = [];
    let open = true;

    for (const ele of allElements()) {
      if (ele.t === 0) {
        // "default" is the Online group
        const id = ele.id === "default" ? "online" : ele.id;
        open = state.layout.getSectionState(groupKey(id), true);
        result.push({ ...ele, id, open });
      } else if (open) {
        result.push(ele);
      }
    }

    return result;
  });

  return (
    <Container aria-label={t`Members`} data-region="members">
      <Deferred>
        <VirtualContainer
          items={elements()}
          scrollTarget={props.scrollTargetElement}
          itemSize={{ height: 42 }}
        >
          {(item) => {
            /**
             * This row's entry. When the list shrinks the container briefly
             * re-renders slots past the new end with an undefined item, so
             * keep the last one instead of crashing mid-update.
             */
            const entry = createMemo<MemberRoleElement>(
              (prev) => item.item ?? prev!,
            );

            return (
              <div
                style={{
                  ...item.style,
                  width: "100%",
                }}
              >
                <Switch
                  fallback={
                    <CategoryTitle
                      role="button"
                      tabIndex={0}
                      aria-expanded={(entry() as { open: boolean }).open}
                      onClick={() =>
                        state.layout.toggleSectionState(
                          groupKey((entry() as { id: string }).id),
                          true,
                        )
                      }
                      onKeyDown={(
                        e: KeyboardEvent & { currentTarget: HTMLElement },
                      ) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          // the virtual container also clicks on Enter, so stop
                          // it here to avoid toggling twice
                          e.stopPropagation();
                          e.currentTarget.click();
                        }
                      }}
                    >
                      <MdChevronRight
                        class="rtl-mirror"
                        {...iconSize(16)}
                        style={{
                          fill: "var(--md-sys-color-on-surface-variant)",
                          transition: "var(--transitions-fast) transform",
                          transform: (entry() as { open: boolean }).open
                            ? "rotateZ(90deg)"
                            : undefined,
                          "flex-shrink": 0,
                        }}
                      />
                      <Show when={entry().icon}>
                        <RoleIcon src={entry().icon!} alt="" />
                      </Show>
                      <Show
                        when={
                          (entry() as { id: string }).id === "online" ||
                          (entry() as { id: string }).id === "offline"
                        }
                      >
                        <UserStatus
                          size="0.7em"
                          status={
                            (entry() as { id: string }).id === "online"
                              ? "Online"
                              : "Invisible"
                          }
                        />
                      </Show>
                      <span>{(entry() as { name: string }).name}</span>
                      <span>
                        {" – "}
                        {(entry() as { count: number }).count}
                      </span>
                    </CategoryTitle>
                  }
                >
                  <Match when={entry().t === 1}>
                    <Member
                      member={(entry() as { member: ServerMember }).member}
                    />
                  </Match>
                </Switch>
              </div>
            );
          }}
        </VirtualContainer>
      </Deferred>
    </Container>
  );
}

/**
 * Group Member Sidebar
 */
export function GroupMemberSidebar(props: Props) {
  const { t } = useLingui();

  return (
    <Container aria-label={t`Members`} data-region="members">
      <MemberTitle>
        <Row align>{props.channel.recipientIds.size} members</Row>
      </MemberTitle>

      <Deferred>
        <VirtualContainer
          items={props.channel.recipients.toSorted((a, b) =>
            a.displayName.localeCompare(b.displayName),
          )}
          scrollTarget={props.scrollTargetElement}
          itemSize={{ height: 42 }}
        >
          {(item) => (
            <div
              style={{
                ...item.style,
                width: "100%",
              }}
            >
              <Member user={item.item} group={props.channel} />
            </div>
          )}
        </VirtualContainer>
      </Deferred>
    </Container>
  );
}

/**
 * Container styles
 */
const Container = styled("aside", {
  base: {
    paddingInlineEnd: "var(--gap-md)",
    width: "var(--layout-width-channel-sidebar)",
  },
});

/**
 * Category Title
 */
const CategoryTitle = styled("div", {
  base: {
    // fills the fixed 42px row: room above, a gap to the first member below
    padding: "14px 14px 8px",
    color: "var(--md-sys-color-on-surface)",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    cursor: "pointer",
    userSelect: "none",

    ...typography.raw({ class: "label", size: "medium" }),
    // a step above member names (15px) so groups stand out
    fontSize: "16px",
    lineHeight: "20px",
    fontWeight: 700,

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});

const RoleIcon = styled("img", {
  base: {
    width: "16px",
    height: "16px",
    borderRadius: "var(--borderRadius-sm)",
    objectFit: "cover",
  },
});

/**
 * Member title
 */
const MemberTitle = styled("div", {
  base: {
    marginTop: "12px",
    marginInlineStart: "14px",
    color: "var(--md-sys-color-on-surface)",

    ...typography.raw({ class: "label", size: "small" }),
  },
  variants: {
    bottomMargin: {
      no: {},
      yes: {
        marginBottom: "-12px",
      },
    },
  },
});

/**
 * Styles required to correctly display name and status
 */
const NameStatusStack = styled("div", {
  base: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
});

function Member(props: {
  user?: User;
  member?: ServerMember;
  group?: Channel;
}) {
  const { t } = useLingui();
  const client = useClient();

  /**
   * Whether this entry is the current user
   */
  const isSelf = () =>
    !!client().user?.id &&
    client().user?.id === (props.user ?? props.member?.user)?.id;

  /**
   * Create user information
   */
  const user = () =>
    userInformation((props.user ?? props.member?.user)!, props.member);

  const timedOut = createIsTimedOut(() => props.member?.timeout);

  const moderationPerms = createMemo(() =>
    props.member?.server?.member?.hasPermission(
      props.member!.server! ?? props.group!,
      "TimeoutMembers",
    ),
  );

  const status = () =>
    (props.user ?? props.member?.user)?.statusMessage((s) =>
      s === "Online"
        ? t`Online`
        : s === "Busy"
          ? t`Busy`
          : s === "Focus"
            ? t`Focus`
            : s === "Idle"
              ? t`Idle`
              : t`Offline`,
    );

  return (
    <div
      use:floating={floatingUserMenus(
        (props.user ?? props.member?.user)!,
        props.member,
        (props.user ?? props.member?.user)?.bot,
        undefined,
        props.group,
      )}
    >
      <MenuButton
        // reachable by keyboard: Enter / Space open the profile card,
        // Shift+F10 opens the context menu
        role="button"
        tabIndex={0}
        onKeyDown={(e: KeyboardEvent & { currentTarget: HTMLElement }) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.currentTarget.click();
          }
        }}
        aria-current={isSelf() ? "true" : undefined}
        size="normal"
        attention={
          isSelf()
            ? "selected"
            : (props.user ?? props.member?.user)?.online
              ? "active"
              : "muted"
        }
        icon={
          <div
            style={{
              opacity: timedOut() && moderationPerms() ? 0.5 : 1,
            }}
          >
            <Avatar
              src={user().avatar}
              size={32}
              holepunch="bottom-right"
              overlay={
                <UserStatus.Graphic
                  status={(props.user ?? props.member?.user)?.presence}
                />
              }
            />
          </div>
        }
      >
        <NameStatusStack>
          <OverflowingText>
            <Row align gap="xs">
              <Username username={user().username} colour={user().colour!} />
              <Show when={timedOut() && moderationPerms}>
                <Tooltip
                  content={t`Timed out until ${props.member!.timeout!.toLocaleString()}`}
                  placement="top"
                >
                  <Symbol size={14}>timer_off</Symbol>
                </Tooltip>
              </Show>
            </Row>
          </OverflowingText>
          <Show when={status()}>
            <Tooltip
              content={() => <TextWithEmoji content={status()!} />}
              placement="top-start"
              aria={status()!}
            >
              <OverflowingText class={typography({ class: "_status" })}>
                <TextWithEmoji content={status()!} />
              </OverflowingText>
            </Tooltip>
          </Show>
        </NameStatusStack>
      </MenuButton>
    </div>
  );
}
