import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";

import { MessageDescriptor, i18n } from "@lingui/core";
import { msg, plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import {
  Direction,
  Recap,
  RecapMeta,
  Sample,
  formatBitrate,
  frozenTimeline,
  recaps,
  recapsRevision,
} from "@revolt/rtc/stats";
import { Button, CircularProgress, Column, Row, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  Charts,
  InfoGrid,
  RecapCsv,
  RecapList as SelectableRecapList,
  Tile,
  TileLabel,
  TileValue,
  Tiles,
  downloadRecapCsvs,
} from "./RecapParts";
import { TimeChart, formatDuration } from "./TimeChart";

/**
 * Titles are `msg` descriptors rendered with `i18n._`, which is not reactive:
 * a language change relies on the full reload (see state/stores/Locale.ts).
 */
export type Metric = {
  key: keyof Sample;
  title: MessageDescriptor;
  format: (v: number) => string;
  only?: Direction;
  /** Charted values, if not the raw sample values */
  values?: (data: Sample[]) => (number | undefined)[];
  yTicks?: number[];
  /** Header text instead of the average */
  summary?: (recap: Recap) => string;
};

const int = (v: number) => String(Math.round(v * 10) / 10);
const ms = (v: number) => `${Math.round(v)} ms`;

/**
 * Charted values, in display order; charts without data are skipped
 */
export const STREAM_METRICS: Metric[] = [
  { key: "bitrate", title: msg`Bitrate`, format: formatBitrate },
  {
    key: "targetBitrate",
    title: msg`Encoder target bitrate`,
    format: formatBitrate,
    only: "sending",
  },
  {
    key: "available",
    title: msg`Estimated upload bandwidth`,
    format: formatBitrate,
    // older recaps of received streams hold a meaningless upload estimate
    only: "sending",
  },
  { key: "fps", title: msg`Frame rate`, format: (v) => `${Math.round(v)} fps` },
  { key: "height", title: msg`Resolution`, format: (v) => `${Math.round(v)}p` },
  {
    key: "activeLayers",
    title: msg`Video copies being sent (full / half / quarter size)`,
    format: int,
    only: "sending",
  },
  {
    key: "frozen",
    title: msg`Running or frozen`,
    format: (v) => (v ? t`Frozen` : t`Running`),
    only: "receiving",
    values: frozenTimeline,
    yTicks: [0, 1],
    summary: (r) => {
      const seconds = r.summary.frozenSeconds.toFixed(1);
      return plural(r.summary.freezes, {
        one: `# freeze, ${seconds} s`,
        other: `# freezes, ${seconds} s`,
      });
    },
  },
  { key: "lost", title: msg`Packets lost per second`, format: int },
  {
    key: "dropped",
    title: msg`Dropped frames per second`,
    format: int,
    only: "receiving",
  },
  {
    key: "nack",
    title: msg`Resend requests per second (viewers asking for lost packets again)`,
    format: int,
  },
  {
    key: "pli",
    title: msg`Keyframe requests per second (viewers asking for a full new picture)`,
    format: int,
  },
  { key: "rtt", title: msg`Ping (round trip to the server)`, format: ms },
  { key: "jitter", title: msg`Jitter`, format: ms, only: "receiving" },
  {
    key: "jitterBuffer",
    title: msg`Jitter buffer delay`,
    format: ms,
    only: "receiving",
  },
];

/** Quality limitation reasons, coloured with status colours */
const LIMITATIONS: Record<string, { label: MessageDescriptor; color: string }> =
  {
    none: {
      label: msg`Not limited`,
      color: "var(--md-sys-color-outline-variant)",
    },
    bandwidth: {
      label: msg`Bandwidth`,
      color: "var(--customColours-warning-color)",
    },
    cpu: { label: msg`CPU`, color: "var(--md-sys-color-error)" },
    other: { label: msg`Other`, color: "var(--md-sys-color-tertiary)" },
  };

const limitationOf = (reason?: string) =>
  LIMITATIONS[reason ?? "none"] ?? LIMITATIONS.other;

/**
 * Heading of a stream recap, the owner and what was streamed
 * @param meta Recap
 */
export function recapTitle(meta: RecapMeta) {
  const { source, participantName: name } = meta;

  if (meta.direction === "sending") {
    return source === "screen_share"
      ? t`Your screen share`
      : source === "camera"
        ? t`Your camera`
        : t`Your ${source}`;
  }

  return source === "screen_share"
    ? t`${name}'s screen share`
    : source === "camera"
      ? t`${name}'s camera`
      : t`${name}'s ${source}`;
}

/**
 * When, how long and where a stream was
 * @param meta Recap
 */
export function recapContext(meta: RecapMeta) {
  return [
    new Date(meta.startedAt).toLocaleString(),
    formatDuration(meta.endedAt - meta.startedAt),
    meta.channelName &&
      `#${meta.channelName}${meta.serverName ? ` (${meta.serverName})` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A stream recap as CSV, one row per second
 * @param recap Recap
 * @returns File name and contents
 */
export function streamRecapCsv(recap: Recap): RecapCsv {
  const keys = STREAM_METRICS.map((m) => m.key).filter((k) =>
    recap.data.some((s) => s[k] !== undefined),
  );
  if (recap.data.some((s) => s.limitation)) keys.push("limitation");

  const rows = [
    ["seconds", ...keys].join(","),
    ...recap.data.map((s) =>
      [(s.t / 1000).toFixed(1), ...keys.map((k) => s[k] ?? "")].join(","),
    ),
  ];

  return {
    name: `stream-recap-${new Date(recap.startedAt)
      .toISOString()
      .replace(/[:.]/g, "-")}.csv`,
    text: rows.join("\n"),
  };
}

/**
 * Stream recaps (developer mode)
 */
export function StreamRecaps() {
  const [selected, setSelected] = createSignal<string>();

  return (
    <Show
      when={selected()}
      fallback={<RecapList onSelect={setSelected} />}
      keyed
    >
      {(id) => <RecapDetail id={id} onBack={() => setSelected()} />}
    </Show>
  );
}

/**
 * Stored stream recaps to open, export or delete
 */
function RecapList(props: { onSelect: (id: string) => void }) {
  const [list] = createResource(recapsRevision, () => recaps.list());

  async function exportRecaps(ids: string[]) {
    const found = await Promise.all(ids.map((id) => recaps.get(id)));
    downloadRecapCsvs(
      found.filter((r) => r !== null).map(streamRecapCsv),
      `stream-recaps-${new Date().toISOString().slice(0, 10)}.zip`,
    );
  }

  return (
    <Column gap="lg">
      <Text class="body">
        <Trans>
          While stream developer mode and "Record stream recaps" are on,
          statistics for every video stream you send or watch in a call are
          recorded once per second. Recaps are stored on this device only; the
          newest 20 are kept.
        </Trans>
      </Text>
      <Switch>
        <Match when={list.loading}>
          <CircularProgress />
        </Match>
        <Match when={!list()?.length}>
          <Text class="label">
            <Trans>
              No recaps yet. Turn on "Record stream recaps", then join a call
              and start or watch a stream.
            </Trans>
          </Text>
        </Match>
        <Match when={list()?.length}>
          <SelectableRecapList
            items={list()!}
            noun="stream"
            icon={(meta) => (
              <Symbol>
                {meta.direction === "sending" ? "upload" : "download"}
              </Symbol>
            )}
            title={recapTitle}
            description={(meta) =>
              `${recapContext(meta)}${
                meta.direction === "receiving" && meta.summary.freezes
                  ? ` · ${plural(meta.summary.freezes, {
                      one: "# freeze",
                      other: "# freezes",
                    })}`
                  : ""
              }`
            }
            onOpen={props.onSelect}
            onExport={exportRecaps}
            onDelete={(ids) => recaps.removeMany(ids)}
            onDeleteAll={() => {
              if (confirm(t`Delete all stream recaps on this device?`)) {
                recaps.clear();
              }
            }}
          />
        </Match>
      </Switch>
    </Column>
  );
}

/**
 * One stored stream recap, loaded by id
 */
function RecapDetail(props: { id: string; onBack: () => void }) {
  const [recap] = createResource(
    () => props.id,
    (id) => recaps.get(id),
  );

  return (
    <Column gap="lg">
      <Row>
        <Button variant="text" size="sm" onPress={props.onBack}>
          <Symbol>arrow_back</Symbol> <Trans>All recaps</Trans>
        </Button>
      </Row>
      <Switch>
        <Match when={recap.loading}>
          <CircularProgress />
        </Match>
        <Match when={!recap()}>
          <Text class="label">
            <Trans>This recap no longer exists.</Trans>
          </Text>
        </Match>
        <Match when={recap()}>
          {(r) => (
            <RecapView
              recap={r()}
              onDelete={() => recaps.remove(r().id).then(props.onBack)}
            />
          )}
        </Match>
      </Switch>
    </Column>
  );
}

/**
 * Header, charts and actions of one stream recap
 */
function RecapView(props: { recap: Recap; onDelete: () => void }) {
  const [hover, setHover] = createSignal<number>();

  const times = createMemo(() => props.recap.data.map((s) => s.t));

  const metrics = createMemo(() =>
    STREAM_METRICS.filter(
      (m) =>
        (!m.only || m.only === props.recap.direction) &&
        props.recap.data.some((s) => typeof s[m.key] === "number"),
    ),
  );

  const tiles = createMemo(() => {
    const { summary, direction } = props.recap;
    const out: [string, string][] = [
      [
        t`Duration`,
        formatDuration(props.recap.endedAt - props.recap.startedAt),
      ],
    ];

    if (summary.maxWidth)
      out.push([t`Max resolution`, `${summary.maxWidth}x${summary.maxHeight}`]);
    if (summary.avgBitrate !== undefined)
      out.push([t`Avg bitrate`, formatBitrate(summary.avgBitrate)]);
    if (summary.avgFps !== undefined)
      out.push([t`Avg frame rate`, `${summary.avgFps.toFixed(1)} fps`]);

    if (direction === "receiving") {
      out.push([
        t`Freezes`,
        `${summary.freezes} (${summary.frozenSeconds.toFixed(1)} s)`,
      ]);
      const packets = summary.received + summary.lost;
      out.push([
        t`Packet loss`,
        packets
          ? `${((summary.lost / packets) * 100).toFixed(2)}%`
          : String(summary.lost),
      ]);
    } else {
      out.push([t`Packets lost (server)`, String(summary.lost)]);
    }

    if (summary.avgRtt !== undefined)
      out.push([
        t`Ping avg / max`,
        `${Math.round(summary.avgRtt)} / ${Math.round(summary.maxRtt ?? 0)} ms`,
      ]);

    return out;
  });

  const info = () =>
    [
      [t`Transport`, props.recap.summary.transports.join(", ") || "-"],
      [t`Codec`, props.recap.info.codec ?? "-"],
      props.recap.direction === "sending"
        ? [t`Encoder`, props.recap.info.encoder ?? "-"]
        : [t`Decoder`, props.recap.info.decoder ?? "-"],
    ] as const;

  function downloadCsv() {
    const csv = streamRecapCsv(props.recap);
    downloadRecapCsvs([csv], csv.name);
  }

  return (
    <>
      <Column gap="xs">
        <Text class="title" size="large">
          {recapTitle(props.recap)}
        </Text>
        <Text class="label">{recapContext(props.recap)}</Text>
      </Column>

      <Tiles>
        <For each={tiles()}>
          {([label, value]) => (
            <Tile>
              <TileLabel>{label}</TileLabel>
              <TileValue>{value}</TileValue>
            </Tile>
          )}
        </For>
      </Tiles>

      <InfoGrid>
        <For each={info()}>
          {([label, value]) => (
            <>
              <TileLabel>{label}</TileLabel>
              <span>{value}</span>
            </>
          )}
        </For>
      </InfoGrid>

      <Show when={props.recap.direction === "sending"}>
        <LimitationStrip
          data={props.recap.data}
          seconds={props.recap.summary.limitation}
        />
      </Show>

      <Text class="label">
        <Trans>
          Hover a chart (or focus it and use the arrow keys) to read all values
          at the same moment.
        </Trans>
      </Text>

      <Charts>
        <For each={metrics()}>
          {(metric) => (
            <TimeChart
              title={i18n._(metric.title)}
              times={times()}
              values={
                metric.values?.(props.recap.data) ??
                props.recap.data.map((s) => s[metric.key] as number | undefined)
              }
              format={metric.format}
              yTicks={metric.yTicks}
              summary={metric.summary?.(props.recap)}
              hover={hover()}
              onHover={setHover}
            />
          )}
        </For>
      </Charts>

      <Row>
        <Button variant="tonal" size="sm" onPress={downloadCsv}>
          <Trans>Download CSV</Trans>
        </Button>
        <Button
          variant="text"
          size="sm"
          onPress={() => {
            if (confirm(t`Delete this recap?`)) props.onDelete();
          }}
        >
          <Trans>Delete recap</Trans>
        </Button>
      </Row>
    </>
  );
}

/**
 * Why the encoder held quality back over time, as a status strip
 */
function LimitationStrip(props: {
  data: Sample[];
  seconds: Record<string, number>;
}) {
  const runs = createMemo(() => {
    const out: { reason: string; count: number }[] = [];
    for (const s of props.data) {
      const reason = s.limitation ?? "none";
      const last = out.at(-1);
      if (last?.reason === reason) last.count++;
      else out.push({ reason, count: 1 });
    }
    return out;
  });

  return (
    <Column gap="sm">
      <Text class="label">
        <Trans>What limited the stream quality</Trans>
      </Text>
      <Strip>
        <For each={runs()}>
          {(run) => (
            <div
              title={`${i18n._(limitationOf(run.reason).label)}: ${run.count} s`}
              style={{
                flex: run.count,
                background: limitationOf(run.reason).color,
              }}
            />
          )}
        </For>
      </Strip>
      <Row gap="lg" wrap>
        <For each={Object.entries(props.seconds)}>
          {([reason, seconds]) => (
            <Legend>
              <Swatch style={{ background: limitationOf(reason).color }} />
              {i18n._(limitationOf(reason).label)}{" "}
              <TileLabel>{formatDuration(seconds * 1000)}</TileLabel>
            </Legend>
          )}
        </For>
      </Row>
    </Column>
  );
}

const Strip = styled("div", {
  base: {
    display: "flex",
    height: "12px",
    borderRadius: "4px",
    overflow: "hidden",
  },
});

const Legend = styled("span", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",
  },
});

const Swatch = styled("span", {
  base: {
    width: "12px",
    height: "12px",
    borderRadius: "3px",
  },
});
