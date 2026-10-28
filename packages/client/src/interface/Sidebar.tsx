import {
  Component,
  JSX,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  on,
} from "solid-js";
import { styled } from "styled-system/jsx";

import { Trans, useLingui } from "@lingui/solid/macro";
import { Channel, Server as ServerI } from "stoat.js";

import {
  CategoryContextMenu,
  ChannelContextMenu,
  ServerSidebarContextMenu,
} from "@revolt/app";
import { useClient, useUser } from "@revolt/client";
import {
  type PhoneTab,
  isHomeRoute,
  tabForRoute,
} from "@revolt/common/lib/phoneTabs";
import Instance from "@revolt/instance/Instance";
import { useModals } from "@revolt/modal";
import {
  useLocation,
  useNavigate,
  useParams,
  useSmartParams,
} from "@revolt/routing";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import { Button, Symbol, Text } from "@revolt/ui";

import { HomePageContent } from "./Home";
import { HomeSidebar, ServerList, ServerSidebar } from "./navigation";
import { BottomNav } from "./navigation/bottomNav/BottomNav";
import { YouScreen } from "./navigation/bottomNav/YouScreen";
import { scrollListsToTop } from "./navigation/bottomNav/scrollToTop";
import { useBottomNav } from "./navigation/bottomNav/useBottomNav";
import type { InboxMentions } from "./navigation/servers/Inbox";
import { InboxScreen, createInboxMentions } from "./navigation/servers/Inbox";
import { useRailHidden } from "./navigation/servers/railMode";
import { createServerKeybinds } from "./navigation/servers/serverKeybinds";

const MainBar = styled("div", {
  base: {
    display: "flex",
    flexShrink: 0,

    _phone: {
      "--layout-width-channel-sidebar": "auto",
      position: "absolute",
      width: "100vw",
      height: "100%",
    },
  },
});

/**
 * Slim tab at the start edge while the server list is hidden. It works on
 * every screen, also those without a header chevron.
 */
const RestoreRail = styled("button", {
  base: {
    flexShrink: 0,
    alignSelf: "stretch",
    width: "16px",
    display: "grid",
    placeItems: "center",
    padding: 0,
    border: 0,
    cursor: "pointer",
    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-container)",
    transition: "var(--transitions-fast) background",

    "&:hover, &:focus-visible": {
      background: "var(--md-sys-color-surface-container-highest)",
    },
  },
});

/**
 * Left-most channel navigation sidebar
 */
export const Sidebar = (props: {
  /**
   * Menu generator TODO FIXME: remove
   */
  menuGenerator: (t: ServerI | Channel) => JSX.Directives["floating"];
}) => {
  const bottomNav = useBottomNav();

  // crossing 600px or toggling the setting remounts the sidebar; accepted
  return (
    <Show
      when={bottomNav()}
      fallback={<DrawerSidebar menuGenerator={props.menuGenerator} />}
    >
      <PhoneSidebar menuGenerator={props.menuGenerator} />
    </Show>
  );
};

/**
 * Server list rail with its data
 */
const Rail = (props: {
  menuGenerator: (t: ServerI | Channel) => JSX.Directives["floating"];
  serversOnly?: boolean;
  inboxMentions?: InboxMentions;
}) => {
  const user = useUser();
  const state = useState();
  const client = useClient();
  const params = useParams<{ server: string }>();

  return (
    <ServerList
      orderedServers={state.ordering.orderedServers(client())}
      orderedEntries={state.ordering.orderedEntries(client())}
      setServerOrder={state.ordering.setServerOrder}
      pinnedConversations={state.ordering.pinnedConversations(client())}
      unreadConversations={state.ordering.orderedConversations(client()).filter(
        // TODO: muting channels; pinned chats show in their own group
        (channel) =>
          channel.unread && !state["pinned-conversations"].isPinned(channel.id),
      )}
      user={user()!}
      selectedServer={() => params.server}
      menuGenerator={props.menuGenerator}
      serversOnly={props.serversOnly}
      inboxMentions={props.inboxMentions}
    />
  );
};

/**
 * Sidebar of the desktop, tablet and drawer-only phone layout: server rail
 * and the home or server channel list side by side
 */
const DrawerSidebar = (props: {
  menuGenerator: (t: ServerI | Channel) => JSX.Directives["floating"];
}) => {
  const state = useState();

  const params = useParams<{ server: string }>();
  const location = useLocation();
  const { t } = useLingui();

  // desktop layout only (not phones or drawer mode); false on Discover, which
  // has no header to bring the list back
  const railHidden = useRailHidden();

  return (
    <MainBar class="main_bar">
      {/* stays mounted while hidden: it owns the server keybinds and inbox tracking */}
      <div style={{ display: railHidden() ? "none" : "contents" }}>
        <Rail menuGenerator={props.menuGenerator} />
      </div>
      <Show when={railHidden()}>
        <RestoreRail
          type="button"
          aria-label={t`Show server list`}
          onClick={() => {
            state.layout.setSectionState(LAYOUT_SECTIONS.RAIL_HIDDEN, false);
            state.layout.setSectionState(
              LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
              true,
              true,
            );
          }}
          use:floating={{
            tooltip: { placement: "right", content: t`Show server list` },
          }}
        >
          <Symbol size={16}>chevron_right</Symbol>
        </RestoreRail>
      </Show>
      <Show
        when={
          state.layout.getSectionState(LAYOUT_SECTIONS.PRIMARY_SIDEBAR, true) &&
          !Instance.relPath(location.pathname).startsWith("/discover")
        }
      >
        <Switch fallback={<Home />}>
          <Match when={params.server}>
            <Server />
          </Match>
        </Switch>
      </Show>
    </MainBar>
  );
};

/**
 * Sidebar of the phone layout with the bottom navigation bar: the screen of
 * the open tab above the bar. The chat and other content pages slide over
 * all of it, so the bar only shows on list screens.
 */
const PhoneSidebar = (props: {
  menuGenerator: (t: ServerI | Channel) => JSX.Directives["floating"];
}) => {
  const state = useState();
  const client = useClient();
  const params = useParams<{ server: string }>();
  const smart = useSmartParams();
  const location = useLocation();

  // server up/down keybinds for every tab (the rail skips them in serversOnly)
  createServerKeybinds(
    () => state.ordering.orderedServers(client()),
    () => params.server,
  );

  // owned here (always mounted) so the Inbox badge keeps counting on every tab
  const inboxMentions = createInboxMentions();

  let tabArea: HTMLDivElement | undefined;

  /** Open tab */
  const tab = () => state.layout.getPhoneTab();

  /** Path without the instance prefix */
  const path = () => Instance.relPath(location.pathname);

  /** The route, in the shape the tab mapping needs */
  const route = createMemo(
    () => ({
      path: path(),
      serverId: smart().serverId,
      channelId: smart().channelId,
      channelType: client()?.channels.get(smart().channelId ?? "")?.type,
    }),
    undefined,
    {
      // a re-run caused by the client or channel lookup must not look like a
      // new route, or it would switch tabs over the user's manual choice
      equals: (a, b) =>
        a.path === b.path &&
        a.serverId === b.serverId &&
        a.channelId === b.channelId &&
        a.channelType === b.channelType,
    },
  );

  // opening a chat or server from elsewhere (link, notification, inbox)
  // switches to the matching tab so that "back" lands on the right list; at
  // launch the saved tab stays when the route is the Home page
  let firstRoute = true;
  createEffect(
    on(route, (current) => {
      const initial = firstRoute;
      firstRoute = false;
      const next = tabForRoute(current);
      if (!next || (initial && next === "home")) return;
      state.layout.setPhoneTab(next);
    }),
  );

  // the Home page lives in the sidebar pane with the bar visible, so keep
  // the content pane out of the way while it is the route
  createEffect(() => {
    const drawer = state.appDrawer();
    if (drawer && isHomeRoute(path())) drawer.setShown(false);
  });

  /**
   * A tab was tapped: open it, or scroll its lists to the top if it is open
   * @param next Tab that was tapped
   * @param repeated Whether it was open already
   */
  function select(next: PhoneTab, repeated: boolean) {
    if (repeated) scrollListsToTop(tabArea);
    else state.layout.setPhoneTab(next);
  }

  return (
    <PhoneMain class="main_bar">
      {/* the bar handles the home indicator inset, so screens above skip it */}
      <TabArea ref={tabArea}>
        <Switch>
          <Match when={tab() === "home"}>
            <HomePageContent embedded />
          </Match>
          <Match when={tab() === "messages"}>
            <Home compact />
          </Match>
          <Match when={tab() === "servers"}>
            <Rail
              menuGenerator={props.menuGenerator}
              serversOnly
              inboxMentions={inboxMentions}
            />
            <Switch fallback={<NoServerOpen />}>
              <Match when={params.server}>
                <Server />
              </Match>
            </Switch>
          </Match>
          <Match when={tab() === "inbox"}>
            <InboxScreen mentions={inboxMentions} />
          </Match>
          <Match when={tab() === "you"}>
            <YouScreen />
          </Match>
        </Switch>
      </TabArea>
      <BottomNav
        active={tab()}
        inboxCount={inboxMentions.count()}
        onSelect={select}
      />
    </PhoneMain>
  );
};

/**
 * Empty state next to the server rail while no server is open
 */
const NoServerOpen: Component = () => {
  const navigate = useNavigate();
  const state = useState();

  return (
    <EmptyServers>
      <Symbol size={48}>groups</Symbol>
      <Text class="title" size="medium">
        <Trans>Pick a server</Trans>
      </Text>
      <Text class="body" size="medium">
        <Trans>Choose a server from the list to see its channels.</Trans>
      </Text>
      <Button
        variant="tonal"
        onPress={() => {
          navigate("/servers");
          state.appDrawer()?.setShown(true);
        }}
      >
        <Trans>Server overview</Trans>
      </Button>
    </EmptyServers>
  );
};

/**
 * Column holding the screen of a tab above the bar
 */
const PhoneMain = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    position: "absolute",
    width: "100vw",
    height: "100%",
    "--layout-width-channel-sidebar": "auto",
  },
});

/**
 * Area of the open tab. The bar below owns the bottom safe area, so it is
 * zeroed here (the call footer and `main` pages would add it a second time).
 */
const TabArea = styled("div", {
  base: {
    display: "flex",
    flex: "1 1 0",
    minWidth: 0,
    minHeight: 0,
    "--safe-area-bottom": "0px",
  },
});

/**
 * Centered empty state of the Servers tab
 */
const EmptyServers = styled("div", {
  base: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "24px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-container-low)",
  },
});

/**
 * Render sidebar for home
 */
const Home: Component<{ compact?: boolean }> = (props) => {
  const params = useSmartParams();
  const client = useClient();
  const state = useState();
  const conversations = createMemo(() =>
    state.ordering.orderedConversations(client()),
  );

  return (
    <HomeSidebar
      compact={props.compact}
      conversations={conversations}
      channelId={params().channelId}
      openSavedNotes={(navigate) => {
        // Check whether the saved messages channel exists already
        const channelId = [...client()!.channels.values()].find(
          (channel) => channel.type === "SavedMessages",
        )?.id;

        if (navigate) {
          if (channelId) {
            // Navigate if exists
            navigate(`/channel/${channelId}`);
          } else {
            // If not, try to create one but only if navigating
            client()!
              .user!.openDM()
              .then((channel) => navigate(`/channel/${channel.id}`));
          }
        }

        // Otherwise return channel ID if available
        return channelId;
      }}
    />
  );
};

/**
 * Render sidebar for a server
 */
const Server: Component = () => {
  const { openModal } = useModals();
  const params = useSmartParams();
  const client = useClient();

  /**
   * Resolve the server
   * @returns Server
   */
  const server = () => client()?.servers.get(params().serverId!);

  /**
   * Open the server information modal
   */
  function openServerInfo() {
    const current = server();
    if (!current) return;

    openModal({
      type: "server_info",
      server: current,
    });
  }

  /**
   * Open the server settings modal
   */
  function openServerSettings() {
    const current = server();
    if (!current) return;

    openModal({
      type: "settings",
      config: "server",
      context: current,
    });
  }

  return (
    <Show when={server()}>
      <ServerSidebar
        server={server()!}
        channelId={params().channelId}
        openServerInfo={openServerInfo}
        openServerSettings={openServerSettings}
        menuGenerator={(target) => ({
          contextMenu: () =>
            target instanceof Channel ? (
              <ChannelContextMenu channel={target} />
            ) : target instanceof ServerI ? (
              <ServerSidebarContextMenu server={target} />
            ) : (
              <Show when={server()}>
                {(current) => (
                  <CategoryContextMenu server={current()} category={target} />
                )}
              </Show>
            ),
        })}
      />
    </Show>
  );
};
