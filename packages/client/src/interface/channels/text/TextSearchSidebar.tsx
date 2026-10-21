import {
  For,
  Show,
  Suspense,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/solid/macro";
import { useQuery } from "@tanstack/solid-query";
import type { API, Channel, Client, Message as MessageClass } from "stoat.js";
import { css } from "styled-system/css";

import { Message } from "@revolt/app";
import { useClient } from "@revolt/client";
import { Button, CircularProgress, Row, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { SearchScopeSwitch, searchScope } from "./SearchScopeSwitch";
import {
  SERVER_SEARCH_CONCURRENCY,
  SERVER_SEARCH_LIMIT,
  SERVER_SEARCH_PER_CHANNEL,
  mergeById,
  runLimited,
} from "./serverSearch";

/** Hides an element visually but keeps it available to screen readers */
const srOnly = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
});

/** Keeps the connected buttons at least 44px tall on phones */
const touchTargets = css({ _phone: { "& button": { minHeight: "44px" } } });

/** Snapshot of everything one search run depends on */
interface SearchParams {
  channel: Channel;
  serverScope: boolean;
  query: Omit<API.DataMessageSearch, "include_users">;
  sort: API.DataMessageSearch["sort"];
}

/** Result of one search run */
interface SearchResult {
  messages: MessageClass[];
  truncated: boolean;
  failed: number;
  total: number;
  order: API.DataMessageSearch["sort"];
}

/** Wait before refetching, so a burst of pin events causes one request */
const REFETCH_DELAY_MS = 400;

/**
 * Make sure messages returned by the pinned search are flagged as pinned in
 * the store. A stored copy can be stale (a pin event for it was dropped), and
 * the pinned view hides messages whose flag is false.
 */
function markPinned(client: Client, messages: MessageClass[]) {
  for (const message of messages) {
    if (client.messages.has(message.id) && !message.pinned) {
      client.messages.updateUnderlyingObject(message.id, {
        pinned: true,
      });
    }
  }
}

/**
 * Quiet empty / error state with an icon, a title and one line of text
 */
function EmptyState(props: {
  icon: string;
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div
      class={css({
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        padding: "24px 16px",
        textAlign: "center",
        color: "var(--md-sys-color-on-surface-variant)",
      })}
    >
      <Symbol size={48}>{props.icon}</Symbol>
      <Text class="title" size="small">
        {props.title}
      </Text>
      <Text class="body" size="medium">
        {props.body}
      </Text>
      <Show when={props.onRetry}>
        <Button variant="tonal" onPress={() => props.onRetry?.()}>
          <Trans>Try again</Trans>
        </Button>
      </Show>
    </div>
  );
}

/**
 * Message search sidebar
 */
export function TextSearchSidebar(props: {
  channel: Channel;
  query: Omit<API.DataMessageSearch, "include_users">;
}) {
  const { t } = useLingui();
  const client = useClient();
  const [sort, setSort] = createSignal<API.DataMessageSearch["sort"]>("Latest");
  const [progress, setProgress] = createSignal<{
    key: string;
    done: number;
    total: number;
  }>();

  /** Result cap named for the cutoff note's message placeholder */
  const limit = SERVER_SEARCH_LIMIT;

  /** Whether there is anything to search for (pins view has no text) */
  const hasQuery = () => !!props.query.pinned || !!props.query.query;

  /** Whether the scope switch is offered: server channels, not the pins view */
  const canSearchServer = () =>
    !!props.channel.serverId && !props.query.pinned && !props.query.sort;

  /** Whether the whole server is being searched */
  const serverScope = () => canSearchServer() && searchScope() === "server";

  /** Sort shown as active, Relevance falls back to Latest in server scope */
  const effectiveSort = () =>
    serverScope() && sort() === "Relevance" ? "Latest" : sort();

  /** Snapshot of the current inputs, used for both query key and query fn */
  const params = (): SearchParams => ({
    channel: props.channel,
    serverScope: serverScope(),
    query: props.query,
    sort: effectiveSort(),
  });

  /** Stable key identifying one search run, also used to scope progress */
  const keyOf = (p: SearchParams) =>
    JSON.stringify([
      "search",
      p.serverScope ? "server" : "channel",
      p.serverScope ? p.channel.serverId : p.channel.id,
      p.query,
      p.sort,
    ]);

  /**
   * Search every readable text channel of the server and merge the results.
   * Throws when every channel failed.
   */
  async function searchServer(
    p: SearchParams,
    key: string,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    const order = p.sort === "Oldest" ? "Oldest" : "Latest";
    const channels = (p.channel.server?.channels ?? []).filter(
      (channel) =>
        channel.type === "TextChannel" &&
        channel.havePermission("ViewChannel") &&
        channel.havePermission("ReadMessageHistory"),
    );

    setProgress({ key, done: 0, total: channels.length });
    const { results, failed } = await runLimited(
      channels,
      SERVER_SEARCH_CONCURRENCY,
      (channel) =>
        channel
          .searchWithUsers({
            ...p.query,
            sort: order,
            limit: SERVER_SEARCH_PER_CHANNEL,
          })
          .then((result) => result.messages),
      (done, total) => setProgress({ key, done, total }),
      signal,
    );

    if (channels.length > 0 && failed === channels.length) {
      throw new Error("every channel failed");
    }

    const merged = mergeById(results, order, SERVER_SEARCH_LIMIT);
    return {
      messages: merged.items,
      // a channel that filled its page may hold more matches
      truncated:
        merged.truncated ||
        results.some((list) => list.length >= SERVER_SEARCH_PER_CHANNEL),
      failed,
      total: channels.length,
      order,
    };
  }

  /** Search only the current channel */
  async function searchChannel(p: SearchParams): Promise<SearchResult> {
    const generation = pinGeneration;
    const messages = await p.channel
      .searchWithUsers(p.query.sort ? p.query : { ...p.query, sort: p.sort })
      .then((result) => result.messages);
    // skip when a pin event arrived meanwhile: the response may be older
    if (p.query.pinned && generation === pinGeneration) {
      markPinned(client(), messages);
    }
    return { messages, truncated: false, failed: 0, total: 1, order: p.sort };
  }

  const query = useQuery(() => {
    const p = params();
    const key = keyOf(p);
    return {
      queryKey: JSON.parse(key) as unknown[],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        p.serverScope ? searchServer(p, key, signal) : searchChannel(p),
      // a failed server search should be retried by the user, not silently
      retry: false,
      enabled: hasQuery(),
    };
  });

  /** Bumped on every pin event, so older search responses can be told apart */
  let pinGeneration = 0;

  /**
   * Keep the pinned list live. A pin or unpin by anyone posts a system
   * message into the channel, which is the one signal that always reaches
   * us (a MessageUpdate for an uncached message is dropped by stoat.js, and
   * an unpin only says `clear: ["Pinned"]`). So refetch, debounced, when such
   * a system message arrives or when a stored message changes its pinned flag.
   */
  createEffect(
    on(
      () => [props.query.pinned, props.channel, client()] as const,
      ([pinned, channel, c]) => {
        if (!pinned) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const refetchSoon = () => {
          pinGeneration++;
          clearTimeout(timer);
          timer = setTimeout(() => void query.refetch(), REFETCH_DELAY_MS);
        };
        const onCreate = (message: MessageClass) => {
          const type = message.systemMessage?.type;
          if (
            message.channelId === channel.id &&
            (type === "message_pinned" || type === "message_unpinned")
          ) {
            refetchSoon();
          }
        };
        const onUpdate = (
          message: MessageClass,
          previous: { pinned?: boolean },
        ) => {
          if (
            message.channelId === channel.id &&
            !!previous.pinned !== message.pinned
          ) {
            refetchSoon();
          }
        };
        c.on("messageCreate", onCreate);
        c.on("messageUpdate", onUpdate);
        onCleanup(() => {
          clearTimeout(timer);
          c.off("messageCreate", onCreate);
          c.off("messageUpdate", onUpdate);
        });
      },
    ),
  );

  /**
   * Messages to show. In the pinned view, a message whose stored flag turned
   * false (own unpin, or an unpin event) disappears right away, before the
   * refetch confirms it.
   */
  const visibleMessages = (messages: MessageClass[]) =>
    props.query.pinned ? messages.filter((m) => m.pinned) : messages;

  /** Progress of the run currently shown, ignoring other runs' progress */
  const currentProgress = () => {
    const current = progress();
    return current && current.key === keyOf(params()) ? current : undefined;
  };

  /** Text read out by the live region: start and final count only */
  const liveText = () => {
    if (query.isFetching) return t`Searching…`;
    if (query.isSuccess) {
      const count = visibleMessages(query.data.messages).length;
      return plural(count, { one: "# result", other: "# results" });
    }
    if (query.isError) return t`Search failed`;
    return "";
  };

  /** Accessible label for the sort button group */
  const sortLabel = () => t`Sort by`;

  return (
    <>
      <Show when={canSearchServer()}>
        <SearchScopeSwitch />
      </Show>
      <Show when={!hasQuery()}>
        {/* phone: the panel opens before anything is typed */}
        <EmptyState
          icon="search"
          title={t`Search messages`}
          body={
            serverScope()
              ? t`Type to search the whole server`
              : t`Type to search this channel`
          }
        />
      </Show>
      <Show when={!props.query.sort && hasQuery()}>
        <div role="group" aria-label={sortLabel()} class={touchTargets}>
          <Row justify="stretch">
            <Show when={!serverScope()}>
              <Button
                group="connected-start"
                groupActive={sort() === "Relevance"}
                aria-pressed={sort() === "Relevance"}
                onPress={() => setSort("Relevance")}
              >
                <Trans>Relevance</Trans>
              </Button>
            </Show>
            <Button
              group={serverScope() ? "connected-start" : "connected"}
              groupActive={effectiveSort() === "Latest"}
              aria-pressed={effectiveSort() === "Latest"}
              onPress={() => setSort("Latest")}
            >
              <Trans>Latest</Trans>
            </Button>
            <Button
              group="connected-end"
              groupActive={effectiveSort() === "Oldest"}
              aria-pressed={effectiveSort() === "Oldest"}
              onPress={() => setSort("Oldest")}
            >
              <Trans>Oldest</Trans>
            </Button>
          </Row>
        </div>
      </Show>
      {/* always mounted so screen readers pick up changes */}
      <div role="status" aria-live="polite" class={srOnly}>
        {liveText()}
      </div>
      <Show when={serverScope() && query.isFetching}>
        {/* visual only: per-channel steps are not announced */}
        <div aria-hidden="true">
          <Text class="label" size="small">
            <Show when={currentProgress()} fallback={<Trans>Searching…</Trans>}>
              {(() => {
                // plain identifiers give the message clean named placeholders
                const done = currentProgress()!.done;
                const total = currentProgress()!.total;
                return (
                  <Plural
                    value={total}
                    one={`Searching ${done} of # channel`}
                    other={`Searching ${done} of # channels`}
                  />
                );
              })()}
            </Show>
          </Text>
        </div>
      </Show>
      <Suspense fallback={<CircularProgress />}>
        <Show when={query.isError}>
          <EmptyState
            icon="error"
            title={t`Search failed`}
            body={t`Something went wrong while searching. Try again.`}
            onRetry={() => query.refetch()}
          />
        </Show>
        <Show when={query.isSuccess && query.data}>
          {(data) => (
            <>
              <Show when={data().failed > 0}>
                <Text class="label" size="small">
                  <Plural
                    value={data().failed}
                    one="# channel could not be searched"
                    other="# channels could not be searched"
                  />
                </Text>
              </Show>
              <Show
                when={
                  !query.isFetching &&
                  visibleMessages(data().messages).length === 0
                }
              >
                <Show
                  when={data().total > 0}
                  fallback={
                    <EmptyState
                      icon="lock"
                      title={t`No channels to search`}
                      body={t`You can't read the message history of any channel on this server.`}
                    />
                  }
                >
                  <EmptyState
                    icon="search_off"
                    title={t`No results`}
                    body={t`Try different words or another scope.`}
                  />
                </Show>
              </Show>
              <For each={visibleMessages(data().messages)}>
                {(message) => (
                  <a href={message.path}>
                    <Show when={serverScope() && message.channel?.name}>
                      <Text class="label" size="small">
                        #{message.channel!.name}
                      </Text>
                    </Show>
                    <Message message={message} isLink />
                  </a>
                )}
              </For>
              <Show when={serverScope() && data().truncated}>
                <Text class="label" size="small">
                  <Show
                    when={data().order === "Oldest"}
                    fallback={<Trans>Showing the newest {limit} results</Trans>}
                  >
                    <Trans>Showing the oldest {limit} results</Trans>
                  </Show>
                </Text>
              </Show>
            </>
          )}
        </Show>
      </Suspense>
    </>
  );
}
