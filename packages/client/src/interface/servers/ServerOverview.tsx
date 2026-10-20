import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";

import { Plural, Trans, useLingui } from "@lingui/solid/macro";
import type { Server } from "stoat.js";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { ServerContextMenu } from "@revolt/app";
import { useClient } from "@revolt/client";
import { useModals } from "@revolt/modal";
import { useState } from "@revolt/state";
import {
  Avatar,
  Button,
  FloatingSelect,
  Header,
  IconButton,
  MenuItem,
  Text,
  TextField,
  main,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { HeaderIcon } from "../common/CommonHeader";
import { ServerBadge } from "../common/ServerBadge";

import {
  type OverviewEntry,
  type OverviewServer,
  type ServerSort,
  filterServers,
  groupByFolder,
  sortServers,
} from "./serverOverview";

/** A server together with the data the sorting and filtering code needs */
type Item = OverviewServer & { server: Server };

/**
 * Overview of all joined servers as a grid of cards, with search and sorting
 */
export function ServerOverview() {
  const { t, i18n } = useLingui();
  const client = useClient();
  const state = useState();
  const { openModal } = useModals();

  /** Open the create server dialog, skipping the choice dialog */
  const createServer = () =>
    openModal({ type: "create_server", client: client() });

  /** Open the join server dialog, skipping the choice dialog */
  const joinServer = () => openModal({ type: "join_server", client: client() });

  /** Search text */
  const [query, setQuery] = createSignal("");

  /** Chosen sort mode, kept while the page is open */
  const [sort, setSort] = createSignal<ServerSort>("rail");

  /**
   * One stable item per server, so the cards are not rebuilt when unread
   * state changes. The live fields are getters that read the reactive data.
   */
  const items = new Map<string, Item>();

  /** Get the stable item of a server for the pure sort and filter helpers */
  const toItem = (server: Server): Item => {
    let item = items.get(server.id);
    if (!item) {
      item = {
        server,
        id: server.id,
        get name() {
          return server.name;
        },
        get description() {
          return server.description;
        },
        get joinedAt() {
          return server.member?.joinedAt?.getTime();
        },
        get unread() {
          return server.unread;
        },
        get mentions() {
          return server.mentions.length;
        },
        get muted() {
          return state.notifications.isMuted(server);
        },
      };
      items.set(server.id, item);
    }
    return item;
  };

  /** All servers in rail order, with folders */
  const entries = createMemo<OverviewEntry<Item>[]>(() =>
    state.ordering.orderedEntries(client()).map((entry) =>
      entry.type === "folder"
        ? {
            type: "folder",
            folder: {
              id: entry.folder.id,
              name: entry.folder.name,
              colour: entry.folder.colour,
              servers: entry.servers.map(toItem),
            },
          }
        : { type: "server", server: toItem(entry.server) },
    ),
  );

  /** All servers in rail order */
  const all = createMemo(() =>
    entries().flatMap((entry) =>
      entry.type === "folder" ? entry.folder.servers : [entry.server],
    ),
  );

  /** Search text without surrounding spaces */
  const search = () => query().trim();

  /**
   * Flat list for any sort other than rail order, and for any search.
   * Undefined when the servers are grouped by folder.
   */
  const flat = createMemo(() => {
    if (sort() === "rail" && !search()) return undefined;
    const matches = new Set(filterServers(all(), search()).map((x) => x.id));
    return sortServers(
      all().filter((item) => matches.has(item.id)),
      sort(),
      i18n().locale,
    );
  });

  /** Folder sections in rail order, used when the list is not flat */
  const sections = createMemo(() => groupByFolder(entries()));

  /** Whether any card is shown */
  const hasResults = () =>
    flat() ? flat()!.length > 0 : sections().length > 0;

  /** Localised short date */
  const formatDate = (date: number) =>
    new Intl.DateTimeFormat(i18n().locale, { dateStyle: "medium" }).format(
      date,
    );

  return (
    <Base>
      <Header placement="primary">
        <HeaderIcon>
          <Symbol>grid_view</Symbol>
        </HeaderIcon>
        <Trans>Servers</Trans>
        <Show when={all().length}>
          <Count>{all().length}</Count>
        </Show>
        <HeaderAction>
          <Button
            variant="filled"
            aria-label={t`Create server`}
            onPress={createServer}
          >
            <Symbol aria-hidden="true">add</Symbol>
            <ActionLabel>
              <Trans>Create server</Trans>
            </ActionLabel>
          </Button>
          <Button
            variant="tonal"
            aria-label={t`Join a server`}
            onPress={joinServer}
          >
            <Symbol aria-hidden="true">login</Symbol>
            <ActionLabel>
              <Trans>Join a server</Trans>
            </ActionLabel>
          </Button>
        </HeaderAction>
      </Header>

      <main class={main()}>
        <div use:scrollable={{ class: scrollArea }}>
          <Switch>
            <Match when={!all().length}>
              <Empty>
                <Symbol size={48}>dns</Symbol>
                <Text class="title">
                  <Trans>No servers yet</Trans>
                </Text>
                <Text class="body">
                  <Trans>Servers you join show up here.</Trans>
                </Text>
                <EmptyActions>
                  <Button variant="tonal" onPress={createServer}>
                    <Trans>Create server</Trans>
                  </Button>
                  <Button variant="outlined" onPress={joinServer}>
                    <Trans>Join a server</Trans>
                  </Button>
                </EmptyActions>
              </Empty>
            </Match>
            <Match when={true}>
              <Toolbar role="search">
                <SearchField>
                  <TextField
                    type="search"
                    variant="outlined"
                    label={t`Search servers`}
                    value={query()}
                    clearable
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </SearchField>
                <SortField>
                  <FloatingSelect
                    variant="outlined"
                    label={t`Sort by`}
                    value={sort()}
                    onChange={(e) =>
                      setSort(e.currentTarget.value as ServerSort)
                    }
                  >
                    <MenuItem value="rail">
                      <Trans>Rail order</Trans>
                    </MenuItem>
                    <MenuItem value="name">
                      <Trans>Name (A-Z)</Trans>
                    </MenuItem>
                    <MenuItem value="recent">
                      <Trans>Recently joined</Trans>
                    </MenuItem>
                    <MenuItem value="oldest">
                      <Trans>Oldest joined</Trans>
                    </MenuItem>
                    <MenuItem value="unread">
                      <Trans>Unread first</Trans>
                    </MenuItem>
                  </FloatingSelect>
                </SortField>
              </Toolbar>

              <Show
                when={hasResults()}
                fallback={
                  <Empty>
                    <Symbol size={48}>search_off</Symbol>
                    <Text class="title">
                      {(() => {
                        const search = query().trim();
                        return <Trans>No servers match "{search}"</Trans>;
                      })()}
                    </Text>
                    <Button variant="text" onPress={() => setQuery("")}>
                      <Trans>Clear search</Trans>
                    </Button>
                  </Empty>
                }
              >
                <Show
                  when={flat()}
                  fallback={
                    <For each={sections()}>
                      {(section) => (
                        <Section>
                          <Show when={section.folder}>
                            {(folder) => (
                              <SectionHeading>
                                <FolderDot
                                  style={{ background: folder().colour }}
                                  aria-hidden="true"
                                />
                                <Text class="label" size="large">
                                  {folder().name}
                                </Text>
                              </SectionHeading>
                            )}
                          </Show>
                          <Grid>
                            <For each={section.servers}>
                              {(item) => (
                                <ServerCard
                                  item={item}
                                  formatDate={formatDate}
                                />
                              )}
                            </For>
                          </Grid>
                        </Section>
                      )}
                    </For>
                  }
                >
                  {(list) => (
                    <Grid>
                      <For each={list()}>
                        {(item) => (
                          <ServerCard item={item} formatDate={formatDate} />
                        )}
                      </For>
                    </Grid>
                  )}
                </Show>
              </Show>
            </Match>
          </Switch>
        </div>
      </main>
    </Base>
  );
}

/**
 * Card for one server: a link to the server with an options button on top
 */
function ServerCard(props: {
  item: Item;
  formatDate: (date: number) => string;
}) {
  const { t } = useLingui();
  const state = useState();

  /** Id of the name element, the accessible name of the link */
  const nameId = () => `server-card-${props.item.id}`;

  /** The server of the card */
  const server = () => props.item.server;

  /** Count of unread mentions, shown for muted servers too (like the rail) */
  const mentions = () => props.item.mentions;

  /** Whether to show the plain unread dot */
  const showDot = () => !props.item.muted && !mentions() && props.item.unread;

  return (
    <li
      class={card}
      use:floating={{
        contextMenu: () => <ServerContextMenu server={server()} />,
      }}
    >
      <CardLink
        href={state.layout.getLastActiveServerPath(server().id)}
        aria-labelledby={nameId()}
      >
        <Banner
          style={{
            "background-image": server().bannerURL
              ? `url("${server().bannerURL}")`
              : undefined,
          }}
        />
        <Body>
          <AvatarSlot>
            <Avatar
              size={56}
              src={server().animatedIconURL ?? server().iconURL}
              fallback={server().name}
            />
          </AvatarSlot>
          <NameRow>
            <Ellipsis id={nameId()}>{server().name}</Ellipsis>
            <BadgeSlot>
              <ServerBadge flags={server().flags} />
            </BadgeSlot>
          </NameRow>
          <Description>
            <Show
              when={server().description}
              fallback={<Trans>No description</Trans>}
            >
              {server().description}
            </Show>
          </Description>
          <Footer>
            <Meta>
              <span>
                <Plural
                  value={server().channelIds.size}
                  one="# channel"
                  other="# channels"
                />
              </span>
              <Show when={props.item.joinedAt}>
                {(joined) => (
                  <span>
                    {(() => {
                      const date = props.formatDate(joined());
                      return <Trans>Joined {date}</Trans>;
                    })()}
                  </span>
                )}
              </Show>
            </Meta>
            <Status>
              <Show when={server().voiceStatus !== "none"}>
                <span role="img" aria-label={t`Someone is in a voice call`}>
                  <Symbol size={18} aria-hidden="true">
                    volume_up
                  </Symbol>
                </span>
              </Show>
              <Show when={mentions()}>
                <MentionBadge aria-label={t`Unread mentions`}>
                  {mentions() > 99 ? "99+" : mentions()}
                </MentionBadge>
              </Show>
              <Show when={showDot()}>
                <UnreadDot role="img" aria-label={t`Unread messages`} />
              </Show>
            </Status>
          </Footer>
        </Body>
      </CardLink>
      {/* sibling of the link, a button must not sit inside an anchor; also
          the way to the menu on phones and with the keyboard */}
      <OptionsSlot>
        <IconButton
          variant="tonal"
          aria-label={(() => {
            const name = server().name;
            return t`Server options for ${name}`;
          })()}
          use:floating={{
            contextMenuHandler: "click",
            contextMenu: () => <ServerContextMenu server={server()} />,
          }}
        >
          <Symbol>more_vert</Symbol>
        </IconButton>
      </OptionsSlot>
    </li>
  );
}

/**
 * Page frame
 */
const Base = styled("div", {
  base: {
    width: "100%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
});

/**
 * Pushes the main action to the inline end of the header; the button is at
 * least 44px high and never wider than the header
 */
const HeaderAction = styled("div", {
  base: {
    marginInlineStart: "auto",
    minWidth: 0,
    flexShrink: 0,
    display: "flex",
    gap: "8px",
    "& button": {
      minHeight: "44px",
      minWidth: "44px",
      gap: "8px",
    },
  },
});

/**
 * Button text, hidden on phones where the button shrinks to its icon (the
 * button keeps its aria-label)
 */
const ActionLabel = styled("span", {
  base: {
    _phone: { display: "none" },
  },
});

/**
 * Number of servers next to the title
 */
const Count = styled("span", {
  base: {
    marginInlineStart: "8px",
    fontSize: "0.875rem",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * Scrolling content area
 */
const scrollArea = css({
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  paddingBlock: "16px",
  boxSizing: "border-box",
});

/**
 * Search and sort controls
 */
const Toolbar = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",

    _phone: {
      flexDirection: "column",
    },
  },
});

/**
 * Search field, takes the free space
 */
const SearchField = styled("div", {
  base: {
    flex: "1 1 240px",
    minWidth: 0,
    "& mdui-text-field": { width: "100%" },
  },
});

/**
 * Sort select
 */
const SortField = styled("div", {
  base: {
    flex: "0 1 240px",
    minWidth: 0,
    "& > *": { width: "100%" },
  },
});

/**
 * A folder (or the servers outside of folders) with its heading
 */
const Section = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
  },
});

/**
 * Folder name above its servers
 */
const SectionHeading = styled("h2", {
  base: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * Small dot in the colour of the folder
 */
const FolderDot = styled("span", {
  base: {
    width: "10px",
    height: "10px",
    flexShrink: 0,
    borderRadius: "var(--borderRadius-circle)",
    background: "var(--md-sys-color-outline)",
  },
});

/**
 * List of cards
 */
const Grid = styled("ul", {
  base: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",

    _phone: {
      gridTemplateColumns: "1fr",
    },
  },
});

/**
 * One list item holding a card
 */
const card = css({
  position: "relative",
  minWidth: 0,
  borderRadius: "var(--borderRadius-lg)",
  background: "var(--md-sys-color-surface-container-low)",
  color: "var(--md-sys-color-on-surface)",
  transition: "var(--transitions-fast) background",

  _hover: {
    background: "var(--md-sys-color-surface-container)",
  },
});

/**
 * The link covering the whole card
 */
const CardLink = styled("a", {
  base: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-lg)",
    color: "inherit",
    textDecoration: "none",
    outlineOffset: "2px",

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
    },
  },
});

/**
 * Banner strip, a quiet surface when the server has no banner
 */
const Banner = styled("div", {
  base: {
    height: "72px",
    flexShrink: 0,
    backgroundSize: "cover",
    backgroundPosition: "center",
    background: "var(--md-sys-color-surface-container-high)",

    _phone: {
      height: "48px",
    },
  },
});

/**
 * Text part of a card below the banner
 */
const Body = styled("div", {
  base: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
    padding: "0 16px 12px",
  },
});

/**
 * Server icon overlapping the banner edge
 */
const AvatarSlot = styled("div", {
  base: {
    width: "fit-content",
    marginBlockStart: "-28px",
    borderRadius: "var(--borderRadius-circle)",
    border: "4px solid var(--md-sys-color-surface-container-low)",
    background: "var(--md-sys-color-surface-container-low)",
  },
});

/**
 * Name and badge
 */
const NameRow = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minWidth: 0,
    fontWeight: 600,
    fontSize: "1rem",
  },
});

/**
 * Keeps the badge icon from shrinking
 */
const BadgeSlot = styled("span", {
  base: {
    flexShrink: 0,
    display: "flex",
    color: "var(--md-sys-color-primary)",
  },
});

/**
 * Description, at most two lines
 */
const Description = styled("p", {
  base: {
    margin: 0,
    fontSize: "0.875rem",
    color: "var(--md-sys-color-on-surface-variant)",
    overflow: "hidden",
    lineClamp: 2,
    overflowWrap: "anywhere",
  },
});

/**
 * Bottom row with details and status
 */
const Footer = styled("div", {
  base: {
    marginBlockStart: "auto",
    paddingBlockStart: "8px",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "28px",
  },
});

/**
 * Channel count and join date
 */
const Meta = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: "12px",
    minWidth: 0,
    fontSize: "0.75rem",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * Voice indicator and unread marker
 */
const Status = styled("div", {
  base: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * Number of unread mentions
 */
const MentionBadge = styled("span", {
  base: {
    minWidth: "20px",
    height: "20px",
    paddingInline: "6px",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--borderRadius-full)",
    fontSize: "0.75rem",
    fontWeight: 600,
    background: "var(--md-sys-color-error)",
    color: "var(--md-sys-color-on-error)",
  },
});

/**
 * Dot for unread messages without mentions
 */
const UnreadDot = styled("span", {
  base: {
    width: "10px",
    height: "10px",
    borderRadius: "var(--borderRadius-circle)",
    background: "var(--md-sys-color-primary)",
  },
});

/**
 * Container of the options button in the top corner of the card; the
 * button is at least 44px, like all touch targets
 */
const OptionsSlot = styled("div", {
  base: {
    position: "absolute",
    insetBlockStart: "4px",
    insetInlineEnd: "4px",
    display: "flex",
    "& button": {
      minWidth: "44px",
      minHeight: "44px",
    },
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
 * The two actions of the empty state, wrapping when the text is long
 */
const EmptyActions = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "8px",
    marginBlockStart: "8px",
  },
});

/**
 * Quiet empty state
 */
const Empty = styled("div", {
  base: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
