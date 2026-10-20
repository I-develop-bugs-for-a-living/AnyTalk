import {
  Accessor,
  For,
  JSX,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  splitProps,
} from "solid-js";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/solid/macro";
import { Channel, Server, User } from "stoat.js";
import { css, cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { ServerFolderContextMenu } from "@revolt/app/menus";
import { useClient } from "@revolt/client";
import { useDevice } from "@revolt/common";
import { useInstance } from "@revolt/instance";
import Instance from "@revolt/instance/Instance";
import { KeybindAction, createKeybind } from "@revolt/keybinds";
import { useLocation, useNavigate, useSmartParams } from "@revolt/routing";
import { ResolvedEntry, useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import {
  Avatar,
  Column,
  Symbol,
  Text,
  Time,
  Unreads,
  UserStatus,
} from "@revolt/ui";
import { VoiceStatus } from "@revolt/ui/components/design/VoiceStatus";
import { Tooltip } from "@revolt/ui/components/floating";

import { INBOX_PANEL_ID, Inbox, createInboxMentions } from "./Inbox";
import { UserMenu } from "./UserMenu";
import {
  aggregatePinBadges,
  shouldStackPins,
  splitPinPreview,
} from "./pinStack";
import { RailEntry, createRailDrag } from "./railDrag";
import { useRailDesktop, useRailWide } from "./railMode";

interface Props {
  /**
   * Ordered server list
   */
  orderedServers: Server[];

  /**
   * Server list grouped into folders, for rendering
   */
  orderedEntries: ResolvedEntry[];

  /**
   * Set ordering of top-level entries
   * @param ids List of IDs
   */
  setServerOrder: (ids: string[]) => void;

  /**
   * Pinned conversations, in pin order
   */
  pinnedConversations: Channel[];

  /**
   * Unread conversations list (pinned ones excluded)
   */
  unreadConversations: Channel[];

  /**
   * Current logged in user
   */
  user: User;

  /**
   * Selected server id
   */
  selectedServer: Accessor<string | undefined>;

  /**
   * Menu generator
   */
  menuGenerator: (target: Server | Channel) => JSX.Directives["floating"];
}

/**
 * Server list sidebar component
 */
export const ServerList = (props: Props) => {
  const state = useState();
  const client = useClient();
  const navigate = useNavigate();
  const { isMobile } = useDevice();
  const { t } = useLingui();
  const instance = useInstance();
  const location = useLocation();
  const wide = useRailWide();
  const desktop = useRailDesktop();

  const navigateServer = (byOffset: number) => {
    const serverId = props.selectedServer();
    if (serverId == null && props.orderedServers.length) {
      if (byOffset === 1) {
        navigate(`/server/${props.orderedServers[0].id}`);
      } else {
        navigate(
          `/server/${props.orderedServers[props.orderedServers.length - 1].id}`,
        );
      }
      return;
    }

    const currentServerIndex = props.orderedServers.findIndex(
      (server) => server.id === serverId,
    );

    const nextIndex = currentServerIndex + byOffset;

    if (nextIndex === -1) {
      return navigate("/app");
    }

    // this will wrap the index around
    const nextServer = props.orderedServers.at(
      nextIndex % props.orderedServers.length,
    );

    if (nextServer) {
      navigate(`/server/${nextServer.id}`);
    }
  };

  createKeybind(KeybindAction.NAVIGATION_SERVER_UP, () => navigateServer(-1));
  createKeybind(KeybindAction.NAVIGATION_SERVER_DOWN, () => navigateServer(1));

  const params = useSmartParams();

  /**
   * Whether the open channel is one of the chat shortcuts on the rail
   */
  const chatShortcutOpen = () => {
    const id = params().channelId;
    return (
      !!id &&
      (props.pinnedConversations.some((c) => c.id === id) ||
        props.unreadConversations.slice(0, 9).some((c) => c.id === id))
    );
  };

  const homeNotifications = createMemo(() => {
    return client().users.filter((user) => user.relationship === "Incoming")
      .length;
  });

  // Ref for floating menu
  const [menuButton, setMenuButton] = createSignal<HTMLElement>();

  // Inbox of unread mentions
  const [inboxButton, setInboxButton] = createSignal<HTMLElement>();
  const [inboxOpen, setInboxOpen] = createSignal(false);
  const inboxMentions = createInboxMentions();
  const inboxLabel = () =>
    inboxMentions.count() > 0
      ? plural(inboxMentions.count(), {
          one: "Inbox, # unread mention",
          other: "Inbox, # unread mentions",
        })
      : t`Inbox`;

  let rail!: HTMLDivElement;

  /**
   * Fold an entry into another
   */
  function fold(target: string, incoming: string) {
    const entries = props.orderedEntries;

    const entry = entries.find((item) => item.id === target);
    if (!entry) return;

    const ids = entries.map((item) => item.id).filter((id) => id !== incoming);

    if (entry.type === "folder") {
      state.ordering.addToFolder(entry.folder.id, incoming);
    } else {
      const folderId = state.ordering.createFolder("New Folder", [
        target,
        incoming,
      ]);

      const at = ids.indexOf(target);
      if (at !== -1) {
        ids[at] = folderId;
      }
    }

    props.setServerOrder(ids);
  }

  /**
   * Move an entry to a new position
   */
  function place(moved: string, before?: string, parent?: string) {
    const currentOrder = props.orderedEntries.map((entry) => entry.id);
    const ids = currentOrder.filter((id) => id !== moved);

    if (parent) {
      state.ordering.placeInFolder(parent, moved, before);
      props.setServerOrder(ids);
      return;
    }

    if (state.ordering.folderOf(moved)) {
      state.ordering.removeFromFolder(moved);
    }

    const at = before ? ids.indexOf(before) : -1;
    const index = at === -1 ? ids.length : at;

    const newOrder = [...ids.slice(0, index), moved, ...ids.slice(index)];

    if (
      newOrder.length === currentOrder.length &&
      newOrder.every((id, i) => id === currentOrder[i])
    ) {
      return;
    }

    props.setServerOrder(newOrder);
  }

  const drag = createRailDrag({
    entries: (): RailEntry[] =>
      props.orderedEntries.flatMap<RailEntry>((entry) =>
        entry.type === "folder"
          ? [
              { id: entry.id, kind: "folder" as const },
              // members are only draggable while you can see them
              ...(entry.folder.collapsed
                ? []
                : entry.servers.map((server) => ({
                    id: server.id,
                    kind: "server" as const,
                    parent: entry.id,
                  }))),
            ]
          : [{ id: entry.id, kind: "server" as const }],
      ),
    container: () => rail,
    label: (id) => {
      for (const entry of props.orderedEntries) {
        if (entry.id === id)
          return entry.type === "folder"
            ? entry.folder.name || t`Folder`
            : entry.server.name;

        if (entry.type !== "folder") continue;

        const member = entry.servers.find((server) => server.id === id);
        if (member) return member.name;
      }
    },
    //TODO - No server ordering on mobile due to usability issue
    //Consider adding a way to enable reordering in user settings
    disabled: () => isMobile,
    onFold: fold,
    onMove: (moved, before, parent) => place(moved, before, parent),
  });

  /**
   * Entry currently being dragged, if any
   */
  const heldEntry = () => {
    if (!drag.pointer()) return undefined;

    const id = drag.dragging();
    const top = props.orderedEntries.find((entry) => entry.id === id);
    if (top) return top;

    // a server being dragged out of an expanded folder
    for (const entry of props.orderedEntries) {
      if (entry.type !== "folder") continue;

      const server = entry.servers.find((member) => member.id === id);
      if (server) return { type: "server", id, server } as ResolvedEntry;
    }
  };

  /**
   * Display name of the current user, shown next to the avatar in wide mode
   */
  const userName = () => props.user.displayName ?? props.user.username;

  /**
   * Whether the drop would land after every entry
   */
  const insertionAtEnd = () => {
    const intent = drag.intent();
    return intent?.type === "move" && intent.before === undefined;
  };

  return (
    <ServerListBase aria-label={t`Servers`} data-region="servers" wide={wide()}>
      <div use:invisibleScrollable={{ direction: "y", class: listBase() }}>
        <a
          class={entryContainer({
            indicator:
              !props.selectedServer() && !chatShortcutOpen()
                ? "selected"
                : undefined,
            wide: wide(),
          })}
          href="/app"
          aria-label={t`Home`}
          use:floating={{
            // wide mode shows the name, the tooltip only stays for the friend requests
            tooltip:
              wide() && homeNotifications() === 0
                ? undefined
                : {
                    content:
                      homeNotifications() > 0
                        ? t`You have ${homeNotifications()} pending friend requests.`
                        : t`Home`,
                    placement: "right",
                  },
          }}
        >
          <Avatar
            size={42}
            fallback={<Symbol fill>home</Symbol>}
            holepunch={homeNotifications() ? "top-right" : undefined}
            overlay={
              <Show when={homeNotifications()}>
                <Unreads.Graphic
                  unread={homeNotifications() !== 0}
                  count={homeNotifications()}
                />
              </Show>
            }
          />
          <Show when={wide()}>
            <RailLabel>
              <Trans>Home</Trans>
            </RailLabel>
          </Show>
        </a>
        <RailTooltip
          hidden={wide()}
          placement="right"
          content={inboxLabel()}
          aria={inboxLabel()}
        >
          <button
            type="button"
            ref={setInboxButton}
            class={entryContainer({ wide: wide() }) + " " + resetButton}
            aria-haspopup="dialog"
            aria-controls={INBOX_PANEL_ID}
            aria-expanded={inboxOpen()}
            aria-label={inboxLabel()}
            onClick={() => setInboxOpen((open) => !open)}
          >
            <Avatar
              size={42}
              fallback={<Symbol fill={inboxOpen()}>inbox</Symbol>}
              holepunch={inboxMentions.count() > 0 ? "top-right" : undefined}
              overlay={
                <Show when={inboxMentions.count() > 0}>
                  <Unreads.Graphic count={inboxMentions.count()} unread />
                </Show>
              }
              interactive
            />
            <Show when={wide()}>
              <RailLabel>
                <Trans>Inbox</Trans>
              </RailLabel>
            </Show>
          </button>
        </RailTooltip>
        <Inbox
          anchor={inboxButton}
          mentions={inboxMentions}
          open={inboxOpen()}
          onClose={() => setInboxOpen(false)}
        />
        <For each={props.unreadConversations.slice(0, 9)}>
          {(conversation) => (
            <ChatShortcut
              conversation={conversation}
              menuGenerator={props.menuGenerator}
            />
          )}
        </For>
        <Show when={props.unreadConversations.length > 9}>
          <a class={entryContainer({ wide: wide() })} href={`/`}>
            <Avatar
              size={42}
              fallback={<>+{props.unreadConversations.length - 9}</>}
            />
            <Show when={wide()}>
              <RailLabel>
                <Trans>More unread chats</Trans>
              </RailLabel>
            </Show>
          </a>
        </Show>
        <Show
          when={shouldStackPins(props.pinnedConversations.length)}
          fallback={
            <For each={props.pinnedConversations}>
              {(conversation) => (
                <ChatShortcut
                  conversation={conversation}
                  menuGenerator={props.menuGenerator}
                  pinned
                />
              )}
            </For>
          }
        >
          <PinStack
            conversations={props.pinnedConversations}
            menuGenerator={props.menuGenerator}
          />
        </Show>
        {/* always separates the top group (home, inbox, chat shortcuts) from the servers; rendered once so it never stacks */}
        <LineDivider />
        <div ref={rail}>
          <For each={props.orderedEntries}>
            {(entry) => (
              <Switch>
                <Match when={entry?.type === "server" && entry}>
                  {(item) => (
                    <ServerEntry
                      server={item().server}
                      selectedServer={props.selectedServer}
                      menuGenerator={props.menuGenerator}
                      drag={drag}
                    />
                  )}
                </Match>
                <Match when={entry?.type === "folder" && entry}>
                  {(item) => (
                    <FolderEntry
                      entry={item()}
                      selectedServer={props.selectedServer}
                      menuGenerator={props.menuGenerator}
                      drag={drag}
                    />
                  )}
                </Match>
              </Switch>
            )}
          </For>
          <Show when={insertionAtEnd()}>
            <div class={railInsertion} style={{ position: "relative" }} />
          </Show>
        </div>
        <div aria-live="polite" class={srOnly}>
          {drag.status()}
        </div>
        <Show when={heldEntry()}>
          {(held) => (
            <div
              class={railGhost}
              style={{
                left: `${(drag.pointer()?.x ?? 0) - RAIL_AVATAR / 2}px`,
                top: `${(drag.pointer()?.y ?? 0) - RAIL_AVATAR / 2}px`,
              }}
            >
              <Switch>
                <Match when={held().type === "server" && held()}>
                  {(item) => (
                    <Avatar
                      size={RAIL_AVATAR}
                      src={(item() as { server: Server }).server.iconURL}
                      fallback={(item() as { server: Server }).server.name}
                    />
                  )}
                </Match>
                <Match when={held().type === "folder" && held()}>
                  {(item) => (
                    <Avatar
                      size={RAIL_AVATAR}
                      fallback={
                        <FolderPreview
                          servers={(item() as { servers: Server[] }).servers}
                          colour={
                            (item() as { folder: { colour?: string } }).folder
                              .colour
                          }
                        />
                      }
                    />
                  )}
                </Match>
              </Switch>
            </div>
          )}
        </Show>
        <RailTooltip
          hidden={wide()}
          placement="right"
          content={t`Server overview`}
        >
          <a
            href="/servers"
            aria-label={t`Server overview`}
            class={entryContainer({
              indicator:
                Instance.relPath(location.pathname) === "/servers"
                  ? "selected"
                  : undefined,
              wide: wide(),
            })}
          >
            <Avatar size={42} fallback={<Symbol>grid_view</Symbol>} />
            <Show when={wide()}>
              <RailLabel>
                <Trans>Server overview</Trans>
              </RailLabel>
            </Show>
          </a>
        </RailTooltip>
        <Show when={instance.isStoat}>
          {/* the tooltip explains more than the short label, so it stays in wide mode */}
          <Tooltip placement="right" content={t`Find new servers to join`}>
            <a
              href={state.layout.getLastActiveDiscoverPath()}
              aria-label={wide() ? t`Discover` : t`Find new servers to join`}
              class={entryContainer({ wide: wide() })}
            >
              <Avatar size={42} fallback={<Symbol fill>explore</Symbol>} />
              <Show when={wide()}>
                <RailLabel>
                  <Trans>Discover</Trans>
                </RailLabel>
              </Show>
            </a>
          </Tooltip>
        </Show>
      </div>
      <Shadow>
        <div />
      </Shadow>
      {/* desktop only: phones always keep the narrow rail */}
      <Show when={desktop()}>
        <button
          type="button"
          class={railToggle({ wide: wide() })}
          aria-label={wide() ? t`Hide server names` : t`Show server names`}
          aria-expanded={wide()}
          onClick={() =>
            state.layout.toggleSectionState(LAYOUT_SECTIONS.RAIL_WIDE, false)
          }
          use:floating={{
            tooltip: wide()
              ? undefined
              : { placement: "right", content: t`Show server names` },
          }}
        >
          <Symbol size={20}>
            {wide()
              ? "keyboard_double_arrow_left"
              : "keyboard_double_arrow_right"}
          </Symbol>
          <Show when={wide()}>
            <RailLabel>
              <Trans>Hide server names</Trans>
            </RailLabel>
          </Show>
        </button>
      </Show>
      <Tooltip
        placement="right"
        content={() => (
          <Column>
            <span>{props.user.username}</span>
            <Text class="label" size="small">
              {props.user.presence === "Online"
                ? t`Online`
                : props.user.presence === "Busy"
                  ? t`Busy`
                  : props.user.presence === "Focus"
                    ? t`Focus`
                    : props.user.presence === "Idle"
                      ? t`Idle`
                      : props.user.presence === "Invisible"
                        ? t`Invisible`
                        : t`Offline`}
            </Text>
          </Column>
        )}
        aria={userName()}
      >
        <button
          type="button"
          ref={setMenuButton}
          class={entryContainer({ wide: wide() }) + " " + resetButton}
          aria-haspopup="menu"
          aria-label={userName()}
        >
          <Avatar
            size={42}
            src={props.user.avatarURL}
            holepunch={"bottom-right"}
            overlay={<UserStatus.Graphic status={props.user.presence} />}
            interactive
          />
          <Show when={wide()}>
            <RailLabel>{userName()}</RailLabel>
          </Show>
        </button>
        <UserMenu anchor={menuButton} />
      </Tooltip>
    </ServerListBase>
  );
};

/**
 * Size of the avatar / icon of every rail entry, also used by the drag ghost
 */
const RAIL_AVATAR = 42;

/**
 * Tooltip which can be switched off, used where wide mode already shows
 * the same text as a visible label
 */
function RailTooltip(
  props: { hidden?: boolean } & Parameters<typeof Tooltip>[0],
) {
  const [local, remote] = splitProps(props, ["hidden"]);

  return (
    <Show when={!local.hidden} fallback={remote.children}>
      <Tooltip {...remote} />
    </Show>
  );
}

/**
 * Name of a rail entry in wide mode, cut off with an ellipsis when too long
 */
function RailLabel(props: { children: JSX.Element }) {
  return (
    <span class={railLabel}>
      <Text class="label" size="large">
        {props.children}
      </Text>
    </span>
  );
}

/**
 * Strips default button chrome so a button can use rail entry styling
 */
const resetButton = css({
  background: "none",
  border: 0,
  padding: 0,
  color: "inherit",
  cursor: "pointer",
});

/**
 * Small pin badge at the bottom corner of a pinned chat shortcut
 */
const PinBadge = styled("span", {
  base: {
    position: "absolute",
    insetBlockEnd: "4px",
    insetInlineEnd: "4px",
    display: "grid",
    placeItems: "center",
    width: "16px",
    height: "16px",
    borderRadius: "var(--borderRadius-circle)",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface-variant)",
    pointerEvents: "none",
  },
  variants: {
    // wide mode: stay on the avatar's end corner instead of the row's end
    wide: {
      true: {
        insetInlineEnd: "auto",
        insetInlineStart: "30px",
      },
      false: {},
    },
  },
});

/**
 * "+N" counter in the last slot of a collapsed pin stack's preview, sized
 * like the preview avatars (in the outer avatar's 32-unit space)
 */
const PinPreviewCounter = styled("span", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "11px",
    height: "11px",
    borderRadius: "var(--borderRadius-circle)",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface)",
    fontSize: "6px",
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
});

/**
 * Shortcut to a DM or group DM on the rail, used for unread and pinned chats
 */
function ChatShortcut(props: {
  conversation: Channel;
  menuGenerator: (target: Server | Channel) => JSX.Directives["floating"];
  pinned?: boolean;
}) {
  const params = useSmartParams();
  const { t } = useLingui();
  const wide = useRailWide();

  return (
    <RailTooltip
      hidden={wide()}
      placement="right"
      content={() => (
        <Show when={props.pinned} fallback={props.conversation.displayName}>
          <Column>
            <span>{props.conversation.displayName}</span>
            <Text class="label" size="small">
              <Trans>Pinned</Trans>
            </Text>
          </Column>
        </Show>
      )}
      aria={
        props.pinned
          ? `${props.conversation.displayName ?? ""} (${t`Pinned`})`
          : (props.conversation.displayName ?? "")
      }
    >
      <a
        class={entryContainer({
          indicator:
            params().channelId === props.conversation.id
              ? "selected"
              : undefined,
          wide: wide(),
        })}
        aria-label={
          props.pinned
            ? `${props.conversation.displayName ?? ""} (${t`Pinned`})`
            : (props.conversation.displayName ?? "")
        }
        use:floating={props.menuGenerator(props.conversation)}
        href={`/channel/${props.conversation.id}`}
      >
        <Avatar
          size={42}
          src={props.conversation.iconURL}
          holepunch={props.conversation.unread ? "top-right" : "none"}
          overlay={
            <Show when={props.conversation.unread}>
              <Unreads.Graphic
                count={props.conversation.mentions?.size ?? 0}
                unread
              />
            </Show>
          }
          fallback={
            props.conversation.name ?? props.conversation.recipient?.username
          }
          interactive
        />
        <Show when={wide()}>
          <RailLabel>{props.conversation.displayName}</RailLabel>
        </Show>
        <Show when={props.pinned}>
          <PinBadge aria-hidden="true" wide={wide()}>
            <Symbol size={12}>push_pin</Symbol>
          </PinBadge>
        </Show>
      </a>
    </RailTooltip>
  );
}

/**
 * Pinned chats folded into one collapsible entry on the rail, used from
 * three pins on. The collapsed state is stored with the pins and synced.
 * Not draggable, and it never collapses on its own when navigating.
 */
function PinStack(props: {
  conversations: Channel[];
  menuGenerator: (target: Server | Channel) => JSX.Directives["floating"];
}) {
  const state = useState();
  const params = useSmartParams();
  const { t } = useLingui();
  const wide = useRailWide();

  const pins = () => state["pinned-conversations"];
  const collapsed = () => pins().isCollapsed();

  const badges = () =>
    aggregatePinBadges(
      props.conversations.map((chat) => ({
        unread: !!chat.unread,
        mentions: chat.mentions?.size ?? 0,
      })),
    );

  const preview = () => splitPinPreview(props.conversations);

  const holdsSelected = () =>
    props.conversations.some((chat) => chat.id === params().channelId);

  /**
   * Collapse or expand the stack
   */
  const toggle = () => pins().toggle();

  return (
    <FolderGroup expanded={!collapsed()} wide={wide()}>
      <RailTooltip hidden={wide()} placement="right" content={t`Pinned chats`}>
        <div
          class={entryContainer({
            indicator:
              collapsed() && holdsSelected()
                ? "selected"
                : collapsed() && badges().unread
                  ? "alert"
                  : undefined,
            wide: wide(),
          })}
        >
          <a
            class={entryLink({ wide: wide() })}
            role="button"
            tabindex="0"
            aria-expanded={!collapsed()}
            aria-label={t`Pinned chats`}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
            }}
          >
            <Avatar
              size={42}
              holepunch={collapsed() && badges().unread ? "top-right" : "none"}
              overlay={
                <Show when={collapsed() && badges().unread}>
                  <Unreads.Graphic count={badges().mentions} unread />
                </Show>
              }
              fallbackBackground={collapsed()}
              fallback={
                <Show
                  when={collapsed()}
                  fallback={<Symbol size={24}>expand_less</Symbol>}
                >
                  <FolderPreviewBase>
                    <For each={preview().shown}>
                      {(chat) => (
                        // 11 units keeps the whole 2x2 grid inside the
                        // stack's circle (13 clips the outer corners)
                        <Avatar
                          size={11}
                          src={chat.iconURL}
                          fallback={chat.name ?? chat.recipient?.username}
                        />
                      )}
                    </For>
                    <Show when={preview().hidden}>
                      <PinPreviewCounter>+{preview().hidden}</PinPreviewCounter>
                    </Show>
                  </FolderPreviewBase>
                </Show>
              }
              interactive
            />
            <Show when={wide()}>
              <RailLabel>
                <Trans>Pinned chats</Trans>
              </RailLabel>
            </Show>
          </a>
          <Show when={collapsed()}>
            <PinBadge aria-hidden="true" wide={wide()}>
              <Symbol size={12}>push_pin</Symbol>
            </PinBadge>
          </Show>
        </div>
      </RailTooltip>
      <Show when={!collapsed()}>
        <div class={folderChildren({ wide: wide() })}>
          <For each={props.conversations}>
            {(conversation) => (
              <ChatShortcut
                conversation={conversation}
                menuGenerator={props.menuGenerator}
                pinned
              />
            )}
          </For>
        </div>
      </Show>
    </FolderGroup>
  );
}

/**
 * A single server in the list
 */
function ServerEntry(props: {
  server: Server;
  selectedServer: Accessor<string | undefined>;
  menuGenerator: (target: Server | Channel) => JSX.Directives["floating"];
  drag: RailDrag;
}) {
  const state = useState();
  const wide = useRailWide();

  return (
    <RailTooltip
      // wide mode shows the name, the tooltip only stays for the muted state
      hidden={wide() && !state.notifications.isMuted(props.server)}
      placement="right"
      content={() => (
        <Column>
          <Text class="label" size="large">
            {props.server.name}
          </Text>{" "}
          <Show when={state.notifications.isMuted(props.server)}>
            <Text class="label" size="small">
              <Show
                when={state.notifications.getServerMute(props.server)!.until}
                fallback={<Trans>Muted</Trans>}
              >
                <Trans>
                  Muted until{" "}
                  <Time
                    format="datetime"
                    value={
                      state.notifications.getServerMute(props.server)!.until
                    }
                  />
                </Trans>
              </Show>
            </Text>
          </Show>
        </Column>
      )}
      aria={props.server.name}
    >
      <div
        ref={(el) => props.drag.register(props.server.id, el)}
        onPointerDown={(e) => props.drag.press(props.server.id, e)}
        onKeyDown={(e) => props.drag.keys(props.server.id, e)}
        class={entryContainer({
          indicator:
            props.selectedServer() === props.server.id
              ? "selected"
              : props.server.unread &&
                  !state.notifications.isMuted(props.server)
                ? "alert"
                : undefined,
          wide: wide(),
        })}
        classList={{
          [railFolding({ wide: wide() })]: isFoldTarget(
            props.drag,
            props.server.id,
          ),
          [railHeld]:
            props.drag.dragging() === props.server.id ||
            props.drag.carrying() === props.server.id,
        }}
        use:floating={props.menuGenerator(props.server)}
      >
        <Show when={isInsertionBefore(props.drag, props.server.id)}>
          <div class={railInsertion} />
        </Show>
        <a
          class={entryLink({ wide: wide() })}
          draggable="false"
          tabindex="0"
          aria-label={props.server.name}
          href={state.layout.getLastActiveServerPath(props.server.id)}
        >
          <Avatar
            size={42}
            src={props.server.iconURL}
            holepunch={
              props.server.mentions.length
                ? props.server.voiceStatus !== "none"
                  ? "right"
                  : "top-right"
                : props.server.voiceStatus !== "none"
                  ? "bottom-right"
                  : "none"
            }
            overlay={
              <>
                <Show
                  when={
                    props.server.mentions.length /* as opposed to item.unread */
                  }
                >
                  <Unreads.Graphic
                    count={props.server.mentions.length}
                    unread
                  />
                </Show>
                <Show when={props.server.voiceStatus !== "none"}>
                  <VoiceStatus.Graphic status={props.server.voiceStatus} />
                </Show>
              </>
            }
            fallback={props.server.name}
            interactive
          />
          <Show when={wide()}>
            <RailLabel>{props.server.name}</RailLabel>
            <Show when={state.notifications.isMuted(props.server)}>
              <Symbol size={16} aria-hidden="true">
                notifications_off
              </Symbol>
            </Show>
          </Show>
        </a>
      </div>
    </RailTooltip>
  );
}

/**
 * A folder of servers, collapsible in place
 */
function FolderEntry(props: {
  entry: Extract<ResolvedEntry, { type: "folder" }>;
  selectedServer: Accessor<string | undefined>;
  menuGenerator: (target: Server | Channel) => JSX.Directives["floating"];
  drag: RailDrag;
}) {
  const state = useState();
  const { t } = useLingui();
  const wide = useRailWide();

  const collapsed = () => props.entry.folder.collapsed ?? false;

  const folderName = () => props.entry.folder.name || t`Folder`;

  const mentions = () =>
    props.entry.servers.reduce(
      (count, server) => count + server.mentions.length,
      0,
    );

  const unread = () =>
    props.entry.servers.some(
      (server) => server.unread && !state.notifications.isMuted(server),
    );

  const holdsSelected = () =>
    props.entry.servers.some((server) => server.id === props.selectedServer());

  return (
    <FolderGroup
      expanded={!collapsed()}
      wide={wide()}
      style={{
        background:
          !collapsed() && props.entry.folder.colour
            ? folderTint(props.entry.folder.colour, 18)
            : undefined,
      }}
    >
      <RailTooltip
        hidden={wide()}
        placement="right"
        content={folderName()}
        aria={folderName()}
      >
        <div
          ref={(el) => props.drag.register(props.entry.id, el)}
          onPointerDown={(e) => props.drag.press(props.entry.id, e)}
          onKeyDown={(e) => props.drag.keys(props.entry.id, e)}
          class={entryContainer({
            indicator:
              collapsed() && holdsSelected()
                ? "selected"
                : collapsed() && unread()
                  ? "alert"
                  : undefined,
            wide: wide(),
          })}
          classList={{
            [railFolding({ wide: wide() })]: isFoldTarget(
              props.drag,
              props.entry.id,
            ),
            [railHeld]:
              props.drag.dragging() === props.entry.id ||
              props.drag.carrying() === props.entry.id,
          }}
          use:floating={{
            contextMenu: () => (
              <ServerFolderContextMenu folder={props.entry.folder} />
            ),
          }}
          style={{ color: props.entry.folder.colour ?? undefined }}
        >
          <Show when={isInsertionBefore(props.drag, props.entry.id)}>
            <div class={railInsertion} />
          </Show>
          <a
            class={entryLink({ wide: wide() })}
            role="button"
            tabindex="0"
            aria-expanded={!collapsed()}
            aria-label={folderName()}
            onClick={() => state.ordering.toggleFolder(props.entry.folder.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                state.ordering.toggleFolder(props.entry.folder.id);
              }
            }}
          >
            <Avatar
              size={42}
              holepunch={collapsed() && mentions() ? "top-right" : "none"}
              overlay={
                <Show when={collapsed() && mentions()}>
                  <Unreads.Graphic count={mentions()} unread />
                </Show>
              }
              fallbackBackground={collapsed() && !!props.entry.servers.length}
              fallback={
                <Show
                  when={collapsed() && props.entry.servers.length}
                  fallback={
                    <Symbol size={24} fill>
                      folder_open
                    </Symbol>
                  }
                >
                  <FolderPreview
                    servers={props.entry.servers}
                    colour={props.entry.folder.colour}
                  />
                </Show>
              }
            />
            <Show when={wide()}>
              <RailLabel>{folderName()}</RailLabel>
              <Symbol size={20}>
                {collapsed() ? "chevron_right" : "expand_more"}
              </Symbol>
            </Show>
          </a>
        </div>
      </RailTooltip>
      <Show when={!collapsed()}>
        <div class={folderChildren({ wide: wide() })}>
          <For each={props.entry.servers}>
            {(server) => (
              <ServerEntry
                server={server}
                selectedServer={props.selectedServer}
                menuGenerator={props.menuGenerator}
                drag={props.drag}
              />
            )}
          </For>
        </div>
      </Show>
    </FolderGroup>
  );
}

type RailDrag = ReturnType<typeof createRailDrag>;

/**
 * Announcements are for screen readers, not for looking at
 */
const srOnly = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
});

/**
 * Whether dropping now would fold into this entry
 * @param drag Rail drag
 * @param id Entry id
 */
function isFoldTarget(drag: RailDrag, id: string) {
  const intent = drag.intent();
  return intent?.type === "fold" && intent.target === id;
}

/**
 * Whether the drop would land immediately above this entry
 * @param drag Rail drag
 * @param id Entry id
 */
function isInsertionBefore(drag: RailDrag, id: string) {
  const intent = drag.intent();
  return intent?.type === "move" && intent.before === id;
}

/**
 * Ring drawn around the entry a drop would fold into
 */
const railFolding = cva({
  base: {
    "&:after": {
      content: "' '",
      position: "absolute",
      top: "3px",
      insetInlineStart: "3px",
      width: "50px",
      height: "50px",
      borderRadius: "var(--borderRadius-circle)",
      outline: "2px solid var(--md-sys-color-primary)",
    },
  },
  variants: {
    // wide mode rings the whole row instead of the icon
    wide: {
      true: {
        "&:after": {
          insetInlineStart: "4px",
          insetInlineEnd: "4px",
          width: "auto",
          borderRadius: "var(--borderRadius-md)",
        },
      },
      false: {},
    },
  },
});

/**
 * The entry being dragged stays in place, faded, so the list never moves
 */
const railHeld = css({
  opacity: 0.35,
});

/**
 * Line showing where a reorder would drop the entry
 */
const railInsertion = css({
  position: "absolute",
  top: "-2px",
  left: "6px",
  right: "6px",
  height: "4px",
  borderRadius: "2px",
  background: "var(--md-sys-color-primary)",
});

/**
 * The dragged entry, following the cursor
 */
const railGhost = css({
  position: "fixed",
  pointerEvents: "none",
  opacity: 0.85,
  zIndex: 1000,
});

/**
 * Collapsed folder preview icons
 */
function FolderPreview(props: { servers: Server[]; colour?: string }) {
  const size = () => (props.servers.length > 2 ? 13 : 16);

  return (
    <FolderPreviewBase
      style={{
        background: props.colour ? folderTint(props.colour, 30) : undefined,
      }}
    >
      <For each={props.servers.slice(0, 4)}>
        {(server) => (
          <Avatar size={size()} src={server.iconURL} fallback={server.name} />
        )}
      </For>
    </FolderPreviewBase>
  );
}

function folderTint(colour: string, amount: number) {
  return `color-mix(in srgb, ${colour} ${amount}%, transparent)`;
}

const FolderPreviewBase = styled("div", {
  base: {
    width: "100%",
    height: "100%",

    display: "flex",
    flexWrap: "wrap",
    gap: "2px",
    alignContent: "center",
    justifyContent: "center",
  },
});

const ServerListBase = styled("nav", {
  base: {
    display: "flex",
    flexDirection: "column",
    paddingBottom: "var(--safe-area-bottom)",

    fill: "var(--md-sys-color-on-surface)",
  },
  variants: {
    // wide mode fixes the width, narrow shrink-wraps the 56px entries
    wide: {
      true: {
        width: "var(--layout-width-server-rail-wide)",
        flexShrink: 0,
      },
      false: {},
    },
  },
});

/**
 * Name of an entry in wide mode
 */
const railLabel = css({
  flex: "1 1 0",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "start",
  color: "var(--md-sys-color-on-surface)",
});

/**
 * Link or button inside an entry container (folders, servers). In wide mode
 * it fills the row so icon, name and chevron lay out in a line.
 */
const entryLink = cva({
  base: {},
  variants: {
    wide: {
      true: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexGrow: 1,
        minWidth: 0,
        height: "100%",
        cursor: "pointer",
        color: "var(--md-sys-color-on-surface)",
      },
      false: {},
    },
  },
});

/**
 * Toggle between the narrow and the wide rail, below the scroll area
 */
const railToggle = cva({
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    flexShrink: 0,
    height: "40px",
    marginBlock: "4px",
    background: "none",
    border: 0,
    padding: 0,
    cursor: "pointer",
    borderRadius: "var(--borderRadius-md)",
    color: "var(--md-sys-color-on-surface-variant)",
    transition: "var(--transitions-fast) background",

    "&:hover": {
      background:
        "color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent)",
    },
  },
  variants: {
    wide: {
      true: {
        marginInline: "8px",
        justifyContent: "flex-start",
        paddingInline: "12px",
      },
      false: {
        width: "40px",
        marginInline: "auto",
      },
    },
  },
});

/**
 * Members of an open folder or pin stack, indented below the header in
 * wide mode
 */
const folderChildren = cva({
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  variants: {
    wide: {
      true: {
        alignItems: "stretch",
        paddingInlineStart: "16px",
        // keeps the selection pill on the rail's edge despite the indent
        "--rail-pill-inset": "-24px",
      },
      false: {},
    },
  },
});

/**
 * Container around list of servers
 */
const listBase = cva({
  base: {
    flexGrow: 1,
  },
});

/**
 * Server entries
 */
const entryContainer = cva({
  base: {
    width: "56px",
    height: "56px",
    position: "relative",
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
    textAlign: "start",

    "&:before": {
      content: "' '",
      position: "absolute",
      width: "12px",
      height: "0px",
      transition: "var(--transitions-fast) all",
      insetInlineStart: "var(--rail-pill-inset, -8px)",
      borderRadius: "4px",
      background: "var(--md-sys-color-on-surface)",
    },

    "&:hover:before": {
      height: "16px",
    },
  },
  variants: {
    indicator: {
      selected: {
        "&:before": {
          height: "32px !important",
        },
      },
      alert: {
        "&:before": {
          height: "8px",
        },
      },
    },
    // wide mode: a row with icon, name and (for folders) a chevron
    wide: {
      true: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        width: "100%",
        paddingInline: "8px",
        borderRadius: "var(--borderRadius-md)",
        color: "var(--md-sys-color-on-surface)",
      },
      false: {},
    },
  },
});

/**
 * Group a folder together with its servers while expanded
 */
const FolderGroup = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
  },
  variants: {
    // wide mode stretches the header row and the indented members
    wide: {
      true: { alignItems: "stretch" },
      false: {},
    },
    expanded: {
      true: {
        paddingBlock: "6px",
        borderRadius: "var(--borderRadius-lg)",
        background:
          "color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent)",
      },
      false: {},
    },
  },
  defaultVariants: { expanded: false },
});

/**
 * Divider line between two lists
 */
const LineDivider = styled("div", {
  base: {
    height: "1px",
    flexShrink: 0,
    margin: "6px auto",
    width: "calc(100% - 24px)",
    background: "var(--md-sys-color-outline-variant)",
  },
});

/**
 * Shadow at the bottom of the list
 */
const Shadow = styled("div", {
  base: {
    height: 0,
    zIndex: 1,
    position: "relative",

    "& div": {
      height: "12px",
      marginTop: "-12px",
      position: "absolute",
      background:
        "linear-gradient(to bottom, transparent, var(--md-sys-color-surface-container-highest))",
    },
  },
});
