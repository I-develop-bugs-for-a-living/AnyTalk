import { For, Show, Suspense, createSignal } from "solid-js";

import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/solid/macro";
import { useQuery } from "@tanstack/solid-query";
import type { API, Channel, Message as MessageClass } from "stoat.js";
import { css } from "styled-system/css";

import { Message } from "@revolt/app";
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
    const messages = await p.channel
      .searchWithUsers(p.query.sort ? p.query : { ...p.query, sort: p.sort })
      .then((result) => result.messages);
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

  /** Progress of the run currently shown, ignoring other runs' progress */
  const currentProgress = () => {
    const current = progress();
    return current && current.key === keyOf(params()) ? current : undefined;
  };

  /** Text read out by the live region: start and final count only */
  const liveText = () => {
    if (query.isFetching) return t`Searching…`;
    if (query.isSuccess) {
      const count = query.data.messages.length;
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
              <Show when={!query.isFetching && data().messages.length === 0}>
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
              <For each={data().messages}>
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
