import {
  type JSX,
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
} from "solid-js";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useDevice } from "@revolt/common";
import {
  type KindGroup,
  type RowEvent,
  type TrafficEntry,
  describeRow,
  entries,
  entryDuration,
  entrySize,
  entryTime,
  filterEntries,
  formatBytes,
  formatClock,
  formatDuration,
  hideCallNoise,
  pauseCutoff,
  recording,
  setRecording,
  showSecrets,
  upToId,
} from "@revolt/traffic";
import { BottomSheet, useSnackbar } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { CheckLabel, Pill, SearchInput } from "./controls";
import { EntryDetails } from "./EntryDetails";
import {
  canOpenTrafficWindow,
  openTrafficWindow,
  trafficWindow,
} from "./trafficWindow";
import { WindowedList } from "./WindowedList";

/** Row height on desktop (one line) in px. */
const ROW_HEIGHT = 32;

/** Row height on phones (two lines, tall enough to tap) in px. */
const ROW_HEIGHT_PHONE = 60;

/** The kind filter chips, in order. */
const GROUPS: (KindGroup | "all")[] = ["all", "http", "ws", "call", "files"];

/**
 * The live view of the network inspector: a filterable list of what the app
 * sent and received, with the details of the selected entry beside it (on a
 * phone, in a bottom sheet).
 *
 * It works in the app's own window and in the inspector's separate window
 * (`popout`), so it listens through native events (`on:click`) and does not
 * use design system buttons, whose events don't fire in another window. A
 * window never gets the phone layout.
 */
export function LiveView(props: { popout?: boolean }) {
  const { t } = useLingui();
  const device = useDevice();
  const snackbar = useSnackbar();

  const phone = () => !props.popout && device.layout() === "phone";

  const [text, setText] = createSignal("");
  const [group, setGroup] = createSignal<KindGroup | "all">("all");
  const [hideNoise, setHideNoise] = createSignal(true);
  /**
   * Highest entry id seen when paused, undefined while live. Only the cutoff
   * is kept, so redaction always follows the current "show tokens" setting.
   */
  const [frozen, setFrozen] = createSignal<number>();
  const [selectedId, setSelectedId] = createSignal<number>();
  const [sheetOpen, setSheetOpen] = createSignal(false);

  const all = createMemo(() => entries({ showSecrets: showSecrets() }));
  const source = createMemo(() => {
    const cutoff = frozen();
    return upToId(all(), cutoff);
  });
  const shown = createMemo(() => {
    const list = hideNoise() ? hideCallNoise(source()) : source();
    return filterEntries(list, {
      group: group() === "all" ? undefined : (group() as KindGroup),
      text: text(),
    });
  });
  const selectedIndex = createMemo(() =>
    shown().findIndex((e) => e.id === selectedId()),
  );
  // entries never change once recorded (apart from timing merged in later),
  // so the details only redraw when the content really differs
  const selected = createMemo(
    () => source().find((e) => e.id === selectedId()),
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  /** Select an entry; on a phone this also opens its details. */
  const select = (id: number) => {
    setSelectedId(id);
    if (phone()) setSheetOpen(true);
  };

  /** Arrow keys move the selection, Enter opens (phone), Escape clears. */
  const onKeyDown = (event: KeyboardEvent) => {
    const list = shown();
    const index = selectedIndex();
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedId(undefined);
      setSheetOpen(false);
      return;
    }
    if (event.key === "Enter") {
      if (phone() && index >= 0) {
        event.preventDefault();
        setSheetOpen(true);
      }
      return;
    }
    if (!list.length) return;
    let next: number | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = index < 0 ? 0 : Math.min(list.length - 1, index + 1);
        break;
      case "ArrowUp":
        next = index < 0 ? list.length - 1 : Math.max(0, index - 1);
        break;
      case "PageDown":
        next = Math.min(list.length - 1, Math.max(0, index) + 10);
        break;
      case "PageUp":
        next = Math.max(0, (index < 0 ? list.length : index) - 10);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = list.length - 1;
        break;
    }
    if (next === undefined) return;
    event.preventDefault();
    // moving with the keys only selects, the sheet opens with Enter
    setSelectedId(list[next].id);
  };

  /** Freeze or release the list. Recording goes on while it is frozen. */
  const togglePause = () =>
    setFrozen(frozen() === undefined ? pauseCutoff(all()) : undefined);

  /** Open the live view in a window of its own. */
  const openWindow = async () => {
    const ok = await openTrafficWindow(t`AnyTalk network inspector`);
    // undefined: already being opened, nothing to say
    if (ok === false) {
      snackbar.show({
        message: t`Could not open the window. Check that pop-ups are allowed.`,
      });
    }
  };

  const groupLabel = (g: KindGroup | "all") =>
    ({
      all: t`All`,
      http: t`HTTP`,
      ws: t`WebSocket`,
      call: t`Call`,
      files: t`Files`,
    })[g];

  return (
    <Root>
      <Toolbar>
        <SearchInput
          type="search"
          value={text()}
          placeholder={t`Filter by address, host or topic`}
          aria-label={t`Filter by address, host or topic`}
          on:input={(e: InputEvent) =>
            setText((e.currentTarget as HTMLInputElement).value)
          }
        />
        <Pill
          type="button"
          aria-pressed={frozen() !== undefined}
          on:click={togglePause}
          title={t`Freeze the list. Recording goes on.`}
        >
          <Symbol size={18}>
            {frozen() !== undefined ? "play_arrow" : "pause"}
          </Symbol>
          {frozen() !== undefined ? t`Resume` : t`Pause`}
        </Pill>
        <Show when={!props.popout && canOpenTrafficWindow()}>
          <Pill type="button" on:click={openWindow}>
            <Symbol size={18}>open_in_new</Symbol>
            {trafficWindow() ? t`Show window` : t`Open as window`}
          </Pill>
        </Show>
      </Toolbar>

      <Chips role="group" aria-label={t`Show only`}>
        <For each={GROUPS}>
          {(g) => (
            <Pill
              type="button"
              aria-pressed={group() === g}
              on:click={() => setGroup(g)}
            >
              {groupLabel(g)}
            </Pill>
          )}
        </For>
      </Chips>

      <Options>
        <CheckLabel>
          <input
            type="checkbox"
            checked={hideNoise()}
            on:change={(e) => setHideNoise(e.currentTarget.checked)}
          />
          <Trans>Hide call signalling noise</Trans>
        </CheckLabel>
        <Count role="status">
          <Show when={!recording()}>
            <Trans>Recording is off</Trans>
            {" · "}
          </Show>
          <Show when={frozen() !== undefined}>
            <Trans>Paused</Trans>
            {" · "}
          </Show>
          {plural(shown().length, { one: "# entry", other: "# entries" })}
        </Count>
      </Options>

      <Body>
        <Switch>
          <Match when={!recording() && source().length === 0}>
            <EmptyState
              icon="radio_button_unchecked"
              title={<Trans>Recording is off</Trans>}
              body={
                <Trans>
                  Turn it on to see what the app sends and receives.
                </Trans>
              }
              action={
                <Pill
                  type="button"
                  kind="filled"
                  on:click={() => setRecording(true)}
                >
                  <Trans>Turn on recording</Trans>
                </Pill>
              }
            />
          </Match>
          <Match when={source().length === 0}>
            <EmptyState
              icon="hourglass_empty"
              title={<Trans>Nothing recorded yet</Trans>}
              body={
                <Trans>
                  Requests and messages show up here as they happen.
                </Trans>
              }
            />
          </Match>
          <Match when={shown().length === 0}>
            <EmptyState
              icon="filter_alt_off"
              title={<Trans>No matches</Trans>}
              body={
                <Trans>
                  Nothing fits this filter. Try another word or show all kinds.
                </Trans>
              }
            />
          </Match>
          <Match when={true}>
            <Split>
              <ListColumn>
                <WindowedList
                  items={shown()}
                  rowHeight={phone() ? ROW_HEIGHT_PHONE : ROW_HEIGHT}
                  selected={selectedIndex()}
                  rowId={(e) => `traffic-row-${e.id}`}
                  activeId={
                    selectedIndex() >= 0
                      ? `traffic-row-${selectedId()}`
                      : undefined
                  }
                  label={t`Recorded traffic`}
                  onKeyDown={onKeyDown}
                >
                  {(entry) => (
                    <EntryRow
                      entry={entry}
                      selected={entry.id === selectedId()}
                      compact={phone()}
                      onSelect={() => select(entry.id)}
                    />
                  )}
                </WindowedList>
              </ListColumn>
              <Show when={!phone()}>
                <Pane aria-label={t`Details`}>
                  <Show
                    when={selected()}
                    fallback={
                      <Hint>
                        <Trans>Select an entry to see its details.</Trans>
                      </Hint>
                    }
                  >
                    {(entry) => <EntryDetails entry={entry()} />}
                  </Show>
                </Pane>
              </Show>
            </Split>
          </Match>
        </Switch>
      </Body>

      <Show when={phone()}>
        <BottomSheet
          show={sheetOpen() && !!selected()}
          onClose={() => setSheetOpen(false)}
          title={t`Details`}
        >
          <Show when={selected()}>
            {(entry) => <EntryDetails entry={entry()} />}
          </Show>
        </BottomSheet>
      </Show>
    </Root>
  );
}

/** Translated name of a row's event. */
function useEventLabel() {
  const { t } = useLingui();
  return (event: RowEvent) =>
    ({
      connect: t`connecting`,
      attached: t`attached`,
      open: t`open`,
      close: t`close`,
      error: t`error`,
      joined: t`joined`,
      route: t`route`,
      bytes: t`bytes`,
      attributes: t`attributes`,
    })[event];
}

/**
 * One row of the list. A single line on desktop; two lines on a phone.
 */
function EntryRow(props: {
  entry: TrafficEntry;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const { t } = useLingui();
  const eventLabel = useEventLabel();
  const row = createMemo(() => describeRow(props.entry));
  /** Summary with the translated route in front, for call connections. */
  const summary = () => {
    const route = row().route;
    if (!route) return row().summary;
    return `${route === "relay" ? t`relay` : t`direct`} · ${row().summary}`;
  };

  /** Method, or arrow and event name. */
  const action = () => {
    const r = row();
    if (r.method) return r.method;
    const arrow = r.dir === "in" ? "↓" : r.dir === "out" ? "↑" : "";
    return [arrow, r.event ? eventLabel(r.event) : ""]
      .filter(Boolean)
      .join(" ");
  };
  const direction = () =>
    row().dir === "in"
      ? t`Received`
      : row().dir === "out"
        ? t`Sent`
        : undefined;
  const failed = () => {
    const s = row().status;
    return s === "ERR" || /^[45]/.test(s);
  };

  return (
    <RowBox
      data-selected={props.selected || undefined}
      data-compact={props.compact || undefined}
      on:click={() => props.onSelect()}
    >
      <Cell data-kind="time">{formatClock(entryTime(props.entry))}</Cell>
      <Badge kind={row().badge} data-kind="badge">
        {row().badge}
      </Badge>
      <Cell data-kind="action" title={direction()}>
        {action()}
      </Cell>
      <Cell data-kind="status" data-failed={failed() || undefined}>
        {row().status}
      </Cell>
      <Cell data-kind="summary">{summary()}</Cell>
      <Cell data-kind="host">{row().host}</Cell>
      <Cell data-kind="size">{formatBytes(entrySize(props.entry))}</Cell>
      <Cell data-kind="duration">
        {formatDuration(entryDuration(props.entry))}
      </Cell>
    </RowBox>
  );
}

/**
 * A quiet, centred empty state: icon, title, one line and an optional action.
 */
function EmptyState(props: {
  icon: string;
  title: JSX.Element;
  body: JSX.Element;
  action?: JSX.Element;
}) {
  return (
    <Empty>
      <Symbol size={48}>{props.icon}</Symbol>
      <strong>{props.title}</strong>
      <span>{props.body}</span>
      {props.action}
    </Empty>
  );
}

/** Fills its box with the toolbar on top and the list below */
const Root = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    height: "100%",
    minHeight: 0,
    padding: "8px",
    boxSizing: "border-box",
    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface)",
    fontFamily: "var(--fonts-primary, sans-serif)",
  },
});

/** Filter field and buttons */
const Toolbar = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
});

/** The kind chips */
const Chips = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "8px" },
});

/** Checkbox and entry count */
const Options = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: "16px",
  },
});

/** Count of shown entries */
const Count = styled("span", {
  base: { fontSize: "13px", color: "var(--md-sys-color-on-surface-variant)" },
});

/** List and details (or an empty state) */
const Body = styled("div", {
  base: {
    flex: "1 1 0",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: "var(--borderRadius-md)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    overflow: "hidden",
    background: "var(--md-sys-color-surface-container-low)",
  },
});

/** List on the left, details on the right */
const Split = styled("div", {
  base: { flex: "1 1 0", minHeight: 0, display: "flex" },
});

/** The list; its width decides which columns fit */
const ListColumn = styled("div", {
  base: {
    flex: "1 1 0",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
  },
});

/** Details of the selected entry */
const Pane = styled("aside", {
  base: {
    flex: "0 0 38%",
    minWidth: "280px",
    maxWidth: "560px",
    overflow: "auto",
    padding: "12px",
    borderInlineStart: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
  },
});

/** Text in the details pane before something is selected */
const Hint = styled("p", {
  base: {
    margin: 0,
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/** Centred empty state */
const Empty = styled("div", {
  base: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "24px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",

    "& strong": { fontSize: "16px", color: "var(--md-sys-color-on-surface)" },
    "& span": { fontSize: "13px" },
    "& button": { marginBlockStart: "8px" },
  },
});

/** A row: a grid of columns on one line, two lines when compact */
const RowBox = styled("div", {
  base: {
    height: "100%",
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns:
      "96px 52px 72px 48px minmax(0, 1fr) minmax(0, 200px) 64px 64px",
    alignItems: "center",
    columnGap: "8px",
    paddingInline: "12px",
    fontSize: "12px",
    cursor: "pointer",
    borderBlockEnd: "1px solid var(--md-sys-color-outline-variant)",

    "&:hover": { background: "var(--md-sys-color-surface-container-high)" },
    "&[data-selected]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },

    // narrow lists drop the least useful columns
    "@container (max-width: 720px)": {
      gridTemplateColumns: "96px 52px 72px 48px minmax(0, 1fr) 64px",
      "& [data-kind='host'], & [data-kind='duration']": { display: "none" },
    },

    // phone: two lines, badge/action/status/time on top, path/host/size below
    "&[data-compact]": {
      gridTemplateColumns: "auto auto auto minmax(0, 1fr)",
      gridTemplateRows: "1fr 1fr",
      rowGap: 0,
      alignContent: "center",
      "& [data-kind='badge']": { gridColumn: 1, gridRow: 1 },
      "& [data-kind='action']": { gridColumn: 2, gridRow: 1 },
      "& [data-kind='status']": { gridColumn: 3, gridRow: 1 },
      "& [data-kind='time']": {
        gridColumn: 4,
        gridRow: 1,
        textAlign: "end",
      },
      "& [data-kind='summary']": { gridColumn: "1 / 4", gridRow: 2 },
      "& [data-kind='host']": {
        display: "block",
        gridColumn: 4,
        gridRow: 2,
        textAlign: "end",
      },
      "& [data-kind='size'], & [data-kind='duration']": { display: "none" },
    },
  },
});

/** One column of a row */
const Cell = styled("span", {
  base: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "var(--fonts-monospace, monospace)",
    "&[data-failed]": { color: "var(--md-sys-color-error)" },
    "&[data-kind='time'], &[data-kind='host']": { opacity: 0.8 },
    "&[data-kind='size'], &[data-kind='duration']": {
      textAlign: "end",
      opacity: 0.8,
    },
  },
});

/** Kind badge of a row */
const Badge = styled("span", {
  base: {
    justifySelf: "start",
    paddingInline: "6px",
    borderRadius: "var(--borderRadius-xs)",
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    lineHeight: "16px",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface-variant)",
  },
  variants: {
    kind: {
      HTTP: {
        background: "var(--md-sys-color-primary-container)",
        color: "var(--md-sys-color-on-primary-container)",
      },
      WS: {
        background: "var(--md-sys-color-tertiary-container)",
        color: "var(--md-sys-color-on-tertiary-container)",
      },
      CALL: {
        background: "var(--md-sys-color-secondary-container)",
        color: "var(--md-sys-color-on-secondary-container)",
      },
      FILE: {},
    },
  },
});
