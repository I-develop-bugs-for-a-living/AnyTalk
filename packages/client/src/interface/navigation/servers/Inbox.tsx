import { useFloating } from "solid-floating-ui";
import {
  Accessor,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Motion, Presence } from "solid-motionone";

import { autoUpdate, flip, offset, shift } from "@floating-ui/dom";
import { Trans, useLingui } from "@lingui/solid/macro";
import type { Channel, Message as StoatMessage } from "stoat.js";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { Message } from "@revolt/app";
import { useClient } from "@revolt/client";
import { neverThrows } from "@revolt/client/safeListener";
import { ackNow, useDevice } from "@revolt/common";
import {
  BottomSheet,
  Button,
  CircularProgress,
  Symbol,
  Text,
} from "@revolt/ui";

import {
  CANCELLED,
  INBOX_FETCH_CONCURRENCY,
  INBOX_LIMIT,
  MentionSource,
  collectMentions,
  countMentions,
  createLimiter,
  hasMentions,
  isExtraMention,
  isNotFoundError,
  isStillUnread,
  mergeMentionIds,
} from "./inboxMentions";

/**
 * Shared queue so opening the inbox never fires more than a few requests at once
 */
const limitFetches = createLimiter(INBOX_FETCH_CONCURRENCY);

/**
 * A channel with its merged mention IDs, in the shape the pure helpers expect
 */
interface InboxSource extends MentionSource {
  channel: Channel;
}

/**
 * Inbox data: reactive unread mentions across all unmuted channels.
 * `count` is the full number (for the rail badge), `list` the newest 50.
 * Muted means the channel or its server is muted (`Channel.muted`).
 *
 * Besides `channel.mentions` (filled by the server on load), it tracks
 * messages received while the app is open that the library does not add:
 * DM and group messages, role mentions we hold and @everyone. Those are kept
 * in memory only and are lost on reload. They count only while newer than
 * the channel's last read message.
 *
 * Messages that cannot be loaded (deleted) are remembered for the session
 * and left out of the list and the count.
 */
export function createInboxMentions() {
  const client = useClient();
  const [live, setLive] = createSignal<Record<string, string[]>>({});
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());

  /**
   * Remember that a message could not be loaded
   * @param id Message ID
   */
  const markFailed = (id: string) =>
    setFailed((previous) =>
      previous.has(id) ? previous : new Set(previous).add(id),
    );

  // subscribe to message events of the current client
  createEffect(() => {
    const c = client();

    // start empty for every client
    setLive({});
    setFailed(new Set<string>());

    const onMessage = neverThrows("inbox", (message: StoatMessage) => {
      const channel = message.channel;
      if (!channel) return;
      const isConversation =
        channel.type === "DirectMessage" || channel.type === "Group";

      if (
        !isExtraMention({
          authorId: message.authorId,
          userId: c.user?.id,
          flags: message.flags,
          isConversation,
          roleMentionIds: message.roleMentionIds,
          memberRoleIds: message.server?.member?.roles,
        })
      )
        return;

      setLive((all) => ({
        ...all,
        [channel.id]: [...(all[channel.id] ?? []), message.id],
      }));
    });

    /**
     * Forget deleted messages
     */
    const forget = (ids: string[]) => {
      setLive((all) => {
        const next: Record<string, string[]> = {};
        for (const [channelId, list] of Object.entries(all)) {
          const kept = list.filter((id) => !ids.includes(id));
          if (kept.length) next[channelId] = kept;
        }
        return next;
      });
      setFailed((previous) => {
        const next = new Set(previous);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    };
    const onDelete = (message: { id: string }) => forget([message.id]);
    const onDeleteBulk = (messages: { id: string }[]) =>
      forget(messages.map((message) => message.id));

    c.on("messageCreate", onMessage);
    c.on("messageDelete", onDelete);
    c.on("messageDeleteBulk", onDeleteBulk);
    onCleanup(() => {
      c.off("messageCreate", onMessage);
      c.off("messageDelete", onDelete);
      c.off("messageDeleteBulk", onDeleteBulk);
    });
  });

  // drop live entries once their channel was read past them
  createEffect(() => {
    const c = client();
    const all = live();
    let changed = false;
    const next: Record<string, string[]> = {};
    for (const [channelId, ids] of Object.entries(all)) {
      const lastRead = c.channelUnreads.get(channelId)?.lastMessageId;
      const kept = ids.filter((id) => isStillUnread(id, lastRead));
      if (kept.length !== ids.length) changed = true;
      if (kept.length) next[channelId] = kept;
    }
    if (changed) setLive(next);
  });

  const sources = createMemo<InboxSource[]>(() => {
    const extras = live();
    const c = client();
    const result: InboxSource[] = [];
    for (const channel of c.channels.toList()) {
      const extra = extras[channel.id];
      if (!channel.mentions?.size && !extra) continue;
      result.push({
        id: channel.id,
        channel,
        muted: channel.muted,
        mentions: mergeMentionIds(
          channel.mentions,
          extra,
          c.channelUnreads.get(channel.id)?.lastMessageId,
        ),
      });
    }
    return result;
  });

  const list = createMemo(() => collectMentions(sources(), failed()));
  const count = createMemo(() => countMentions(sources(), failed()));
  // every unmuted channel with something in it, not only those in the capped list
  const channels = createMemo(() =>
    sources()
      .filter(hasMentions)
      .map((source) => source.channel),
  );

  return { list, count, channels, markFailed };
}

/**
 * Inbox data, see `createInboxMentions`
 */
export type InboxMentions = ReturnType<typeof createInboxMentions>;

interface Props {
  /**
   * Rail button the inbox opens from
   */
  anchor: Accessor<HTMLElement | undefined>;

  /**
   * Inbox data
   */
  mentions: InboxMentions;

  /**
   * Whether the inbox is open
   */
  open: boolean;

  /**
   * Close the inbox
   */
  onClose: () => void;
}

/**
 * Element ID of the inbox panel, used by the rail button's `aria-controls`
 */
export const INBOX_PANEL_ID = "inbox-panel";

/**
 * Inbox of unread mentions: a popover next to the rail on desktop and a
 * bottom sheet on phones.
 */
export function Inbox(props: Props) {
  const device = useDevice();
  const { t } = useLingui();

  // phones: a touch browser or a narrow window (matches the `phone` breakpoint)
  const query = window.matchMedia("(max-width: 600px)");
  const [narrow, setNarrow] = createSignal(query.matches);
  const onChange = () => setNarrow(query.matches);
  query.addEventListener("change", onChange);
  onCleanup(() => query.removeEventListener("change", onChange));
  const isMobile = () => device.isMobile || narrow();

  return (
    <Show
      when={!isMobile()}
      fallback={
        <BottomSheet
          id={INBOX_PANEL_ID}
          show={props.open}
          onClose={props.onClose}
          title={t`Inbox`}
        >
          <InboxContent
            mentions={props.mentions}
            onClose={props.onClose}
            inSheet
          />
        </BottomSheet>
      }
    >
      <InboxPopover
        mentions={props.mentions}
        anchor={props.anchor}
        open={props.open}
        onClose={props.onClose}
      />
    </Show>
  );
}

/**
 * Desktop popover anchored to the side of the rail button that faces the
 * page. The rail sits at the inline start of the layout, so in right-to-left
 * languages it is on the right and the popover opens to the left.
 *
 * Focus moves into it when it opens. On close it goes back to the rail
 * button, but only if focus was inside the popover or Escape was pressed,
 * so a click on a row leaves focus where navigation puts it.
 */
function InboxPopover(props: Props) {
  const { t } = useLingui();
  let panel: HTMLDivElement | undefined;
  const [ref, setRef] = createSignal<HTMLDivElement>();

  // read when the language is applied; the rail flips with the page direction
  const rtl = () => document.documentElement.dir === "rtl";

  const position = useFloating(() => props.anchor(), ref, {
    placement: rtl() ? "left-start" : "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  // Escape and outside click close it
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;

        let escaped = false;
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            escaped = true;
            props.onClose();
          }
        };
        const onPointer = (event: PointerEvent) => {
          const target = event.target as Node;
          // the rail button toggles on its own click
          if (props.anchor()?.contains(target)) return;
          if (panel?.contains(target)) return;
          props.onClose();
        };

        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onPointer);
        onCleanup(() => {
          document.removeEventListener("keydown", onKey);
          document.removeEventListener("pointerdown", onPointer);
          if (escaped || panel?.contains(document.activeElement)) {
            props.anchor()?.focus();
          }
        });
      },
    ),
  );

  return (
    <Portal mount={document.getElementById("floating")!}>
      <Presence>
        <Show when={props.open}>
          <Motion
            id={INBOX_PANEL_ID}
            ref={(el: HTMLDivElement) => {
              panel = el;
              setRef(el);
              // wait for the element to be in the page before focusing it
              requestAnimationFrame(() => el.focus());
            }}
            role="dialog"
            aria-label={t`Inbox`}
            tabIndex={-1}
            style={{
              position: position.strategy,
              top: `${position.y ?? 0}px`,
              left: `${position.x ?? 0}px`,
              "z-index": 100,
            }}
            initial={{ opacity: 0, x: rtl() ? 16 : -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, easing: [0.87, 0, 0.13, 1] }}
          >
            <PopoverSurface>
              <InboxContent mentions={props.mentions} onClose={props.onClose} />
            </PopoverSurface>
          </Motion>
        </Show>
      </Presence>
    </Portal>
  );
}

/**
 * Header and list, shared by the popover and the bottom sheet.
 * The sheet has its own title and close button, so it only gets the
 * "Mark all read" row.
 */
function InboxContent(props: {
  mentions: InboxMentions;
  onClose: () => void;
  inSheet?: boolean;
}) {
  let list: HTMLUListElement | undefined;

  // rows are keyed by message ID, so new mentions and acks only touch their
  // own rows instead of rebuilding (and refetching) the whole list
  const ids = createMemo(() => props.mentions.list().map((m) => m.messageId));
  const channelById = createMemo(
    () => new Map(props.mentions.list().map((m) => [m.messageId, m.channel])),
  );
  const hasList = () => ids().length > 0;
  const capped = () => props.mentions.count() > INBOX_LIMIT;

  /**
   * Mark every unmuted channel with mentions as read right away,
   * not only the ones in the (capped) list
   */
  function markAllRead() {
    for (const channel of props.mentions.channels()) {
      if (channel.lastMessageId) ackNow(channel, channel.lastMessageId);
    }
  }

  /**
   * Move between rows with the arrow keys
   */
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = Array.from(
      list?.querySelectorAll<HTMLElement>("a[data-inbox-row]") ?? [],
    );
    const index = links.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? links[index + 1]
        : index > 0
          ? links[index - 1]
          : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <Content>
      <Show when={hasList() || !props.inSheet}>
        <HeaderRow>
          <Show when={!props.inSheet}>
            <Text class="title" size="medium">
              <Trans>Inbox</Trans>
            </Text>
          </Show>
          <Show when={hasList()}>
            <Button
              variant="text"
              size={props.inSheet ? "md" : "sm"}
              onPress={markAllRead}
            >
              <Trans>Mark all read</Trans>
            </Button>
          </Show>
        </HeaderRow>
      </Show>
      <Show
        when={hasList()}
        fallback={
          <Empty>
            <Symbol size={48}>done_all</Symbol>
            <Text class="title" size="medium">
              <Trans>You're all caught up</Trans>
            </Text>
            <Text class="body" size="medium">
              <Trans>Mentions and new direct messages show up here.</Trans>
            </Text>
          </Empty>
        }
      >
        <List ref={list} onKeyDown={onKeyDown}>
          <For each={ids()}>
            {(id) => {
              // the channel of a row never changes, read it once
              const channel = untrack(() => channelById().get(id)?.channel);
              return (
                <Show when={channel}>
                  {(ch) => (
                    <InboxRow
                      id={id}
                      channel={ch()}
                      mentions={props.mentions}
                      onNavigate={props.onClose}
                    />
                  )}
                </Show>
              );
            }}
          </For>
        </List>
        <Show when={capped()}>
          <Note class="label" size="small">
            <Trans>Showing the {INBOX_LIMIT} newest</Trans>
          </Note>
        </Show>
      </Show>
    </Content>
  );
}

/**
 * Where a channel is, for the line above a mention
 * @param channel Channel the mention is in
 * @returns "Server · #channel", or the DM user or group name
 */
function contextLabel(channel: Channel): string {
  if (channel.type === "TextChannel") {
    return `${channel.server?.name ?? ""} · #${channel.name}`;
  }
  return channel.displayName ?? "";
}

/**
 * One mention: loads its message lazily. A message that cannot be loaded
 * (deleted) is reported to the inbox, which then drops the row.
 *
 * Markup: the message is shown for sighted users in an `inert` block, and a
 * separate link covers the whole row. Nesting the message inside an `<a>`
 * would put links and buttons (mentions, embeds, spoilers) inside a link,
 * which is invalid HTML. The overlay link has an `aria-label` with author,
 * place and the start of the text, so screen readers get one clear target.
 * Enter follows the link natively and Space is added to match a button.
 */
function InboxRow(props: {
  id: string;
  channel: Channel;
  mentions: InboxMentions;
  onNavigate: () => void;
}) {
  const client = useClient();
  const { t } = useLingui();
  const channel = untrack(() => props.channel);
  const messageId = untrack(() => props.id);

  // set when the row goes away, so a queued request is skipped
  let disposed = false;
  onCleanup(() => (disposed = true));

  const [message] = createResource(async () => {
    const cached = client().messages.get(messageId);
    if (cached) return cached;
    try {
      return await limitFetches(
        () => channel.fetchMessage(messageId),
        () => disposed,
      );
    } catch (error) {
      // only a real "not found" is remembered; other failures (network, 5xx,
      // rate limit) just hide the row, and the next open tries again
      if (error !== CANCELLED && isNotFoundError(error)) {
        props.mentions.markFailed(messageId);
      }
      return undefined;
    }
  });

  /**
   * Leave focus to the navigation instead of returning it to the rail,
   * then close
   */
  const open = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    props.onNavigate();
  };

  return (
    <Show
      when={!message.loading}
      fallback={
        <LoadingRow aria-busy="true">
          <span class={srOnly}>{t`Loading message`}</span>
          <CircularProgress />
        </LoadingRow>
      }
    >
      <Show when={message()}>
        {(msg) => {
          const author = () => msg().author?.displayName ?? "";
          const place = () => contextLabel(channel);
          const preview = () => msg().content.slice(0, 200);
          return (
            <RowItem>
              <div inert aria-hidden="true">
                <ContextLine class="label" size="small">
                  {place()}
                </ContextLine>
                <Message message={msg()} isLink />
              </div>
              <RowLink
                data-inbox-row
                href={msg().path}
                aria-label={t`Open message from ${author()} in ${place()}: ${preview()}`}
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === " ") {
                    event.preventDefault();
                    event.currentTarget.click();
                  }
                }}
              />
            </RowItem>
          );
        }}
      </Show>
    </Show>
  );
}

/**
 * Hides text from sight but not from screen readers
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
 * Rounded surface of the desktop popover
 */
const PopoverSurface = styled("div", {
  base: {
    width: "min(420px, calc(100vw - 16px))",
    maxHeight: "70dvh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",
    boxShadow: "0 0 8px var(--md-sys-color-shadow)",
  },
});

/**
 * Column holding header and list
 */
const Content = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    flexGrow: 1,
  },
});

/**
 * Title and the mark-all-read button
 */
const HeaderRow = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexShrink: 0,
    paddingInline: "16px 8px",
    paddingBlock: "8px",
    minHeight: "48px",
  },
});

/**
 * Scrolling list of mentions
 */
const List = styled("ul", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    overflowY: "auto",
    minHeight: 0,
  },
});

/**
 * One mention, with the overlay link on top
 */
const RowItem = styled("li", {
  base: {
    position: "relative",
    minHeight: "44px",
    paddingBlock: "8px",
    paddingInline: "8px",
    borderBlockStart: "1px solid var(--md-sys-color-outline-variant)",
    transition: "var(--transitions-fast) background",

    "&:hover": {
      background:
        "color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent)",
    },
  },
});

/**
 * Link that covers the whole row
 */
const RowLink = styled("a", {
  base: {
    position: "absolute",
    inset: 0,
    cursor: "pointer",

    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});

/**
 * "Server · #channel" above a mention
 */
const ContextLine = styled(Text, {
  base: {
    display: "block",
    paddingInline: "8px",
    color: "var(--md-sys-color-on-surface-variant)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

/**
 * Placeholder while a message loads
 */
const LoadingRow = styled("li", {
  base: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    minHeight: "64px",
  },
});

/**
 * Centered empty state
 */
const Empty = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "32px 24px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * Note under a capped list
 */
const Note = styled(Text, {
  base: {
    flexShrink: 0,
    padding: "8px 16px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
