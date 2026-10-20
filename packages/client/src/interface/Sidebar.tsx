import { Component, JSX, Match, Show, Switch, createMemo } from "solid-js";
import { styled } from "styled-system/jsx";

import { useLingui } from "@lingui/solid/macro";
import { Channel, Server as ServerI } from "stoat.js";

import {
  CategoryContextMenu,
  ChannelContextMenu,
  ServerSidebarContextMenu,
} from "@revolt/app";
import { useClient, useUser } from "@revolt/client";
import Instance from "@revolt/instance/Instance";
import { useModals } from "@revolt/modal";
import { useLocation, useParams, useSmartParams } from "@revolt/routing";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import { Symbol } from "@revolt/ui";

import { HomeSidebar, ServerList, ServerSidebar } from "./navigation";
import { useRailHidden } from "./navigation/servers/railMode";

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
  const user = useUser();
  const state = useState();
  const client = useClient();

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
        <ServerList
          orderedServers={state.ordering.orderedServers(client())}
          orderedEntries={state.ordering.orderedEntries(client())}
          setServerOrder={state.ordering.setServerOrder}
          pinnedConversations={state.ordering.pinnedConversations(client())}
          unreadConversations={state.ordering
            .orderedConversations(client())
            .filter(
              // TODO: muting channels; pinned chats show in their own group
              (channel) =>
                channel.unread &&
                !state["pinned-conversations"].isPinned(channel.id),
            )}
          user={user()!}
          selectedServer={() => params.server}
          menuGenerator={props.menuGenerator}
        />
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
 * Render sidebar for home
 */
const Home: Component = () => {
  const params = useSmartParams();
  const client = useClient();
  const state = useState();
  const conversations = createMemo(() =>
    state.ordering.orderedConversations(client()),
  );

  return (
    <HomeSidebar
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
