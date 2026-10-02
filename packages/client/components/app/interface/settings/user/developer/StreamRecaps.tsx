import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";

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
import {
  Button,
  CategoryButton,
  CircularProgress,
  Column,
  Row,
  Text,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  Charts,
  InfoGrid,
  Tile,
  TileLabel,
  TileValue,
  Tiles,
} from "./RecapParts";
import { TimeChart, formatDuration } from "./TimeChart";

type Metric = {
  key: keyof Sample;
  title: string;
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
const METRICS: Metric[] = [
  { key: "bitrate", title: "Bitrate", format: formatBitrate },
  {
    key: "targetBitrate",
    title: "Encoder target bitrate",
    format: formatBitrate,
    only: "sending",
  },
  {
    key: "available",
    title: "Estimated upload bandwidth",
    format: formatBitrate,
    // older recaps of received streams hold a meaningless upload estimate
    only: "sending",
  },
  { key: "fps", title: "Frame rate", format: (v) => `${Math.round(v)} fps` },
  { key: "height", title: "Resolution", format: (v) => `${Math.round(v)}p` },
  {
    key: "activeLayers",
    title: "Video copies being sent (full / half / quarter size)",
    format: int,
    only: "sending",
  },
  {
    key: "frozen",
    title: "Running or frozen",
    format: (v) => (v ? "Frozen" : "Running"),
    only: "receiving",
    values: frozenTimeline,
    yTicks: [0, 1],
    summary: (r) =>
      `${r.summary.freezes} freezes, ${r.summary.frozenSeconds.toFixed(1)} s`,
  },
  { key: "lost", title: "Packets lost per second", format: int },
  {
    key: "dropped",
    title: "Dropped frames per second",
    format: int,
    only: "receiving",
  },
  {
    key: "nack",
    title: "Resend requests per second (viewers asking for lost packets again)",
    format: int,
  },
  {
    key: "pli",
    title:
      "Keyframe requests per second (viewers asking for a full new picture)",
    format: int,
  },
  { key: "rtt", title: "Ping (round trip to the server)", format: ms },
  { key: "jitter", title: "Jitter", format: ms, only: "receiving" },
  {
    key: "jitterBuffer",
    title: "Jitter buffer delay",
    format: ms,
    only: "receiving",
  },
];

/** Quality limitation reasons, coloured with status colours */
const LIMITATIONS: Record<string, { label: string; color: string }> = {
  none: { label: "Not limited", color: "var(--md-sys-color-outline-variant)" },
  bandwidth: {
    label: "Bandwidth",
    color: "var(--customColours-warning-color)",
  },
  cpu: { label: "CPU", color: "var(--md-sys-color-error)" },
  other: { label: "Other", color: "var(--md-sys-color-tertiary)" },
};

const limitationOf = (reason?: string) =>
  LIMITATIONS[reason ?? "none"] ?? LIMITATIONS.other;

function sourceName(source: string) {
  return source === "screen_share"
    ? "screen share"
    : source === "camera"
      ? "camera"
      : source;
}

function recapTitle(meta: RecapMeta) {
  return meta.direction === "sending"
    ? `Your ${sourceName(meta.source)}`
    : `${meta.participantName}'s ${sourceName(meta.source)}`;
}

function recapContext(meta: RecapMeta) {
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

function RecapList(props: { onSelect: (id: string) => void }) {
  const [list] = createResource(recapsRevision, () => recaps.list());

  return (
    <Column gap="lg">
      <Text class="body">
        While stream developer mode and "Record stream recaps" are on,
        statistics for every video stream you send or watch in a call are
        recorded once per second. Recaps are stored on this device only; the
        newest 20 are kept.
      </Text>
      <Switch>
        <Match when={list.loading}>
          <CircularProgress />
        </Match>
        <Match when={!list()?.length}>
          <Text class="label">
            No recaps yet. Turn on "Record stream recaps", then join a call and
            start or watch a stream.
          </Text>
        </Match>
        <Match when={list()?.length}>
          <CategoryButton.Group>
            <For each={list()}>
              {(meta) => (
                <CategoryButton
                  icon={
                    <Symbol>
                      {meta.direction === "sending" ? "upload" : "download"}
                    </Symbol>
                  }
                  description={`${recapContext(meta)}${
                    meta.direction === "receiving" && meta.summary.freezes
                      ? ` · ${meta.summary.freezes} freezes`
                      : ""
                  }`}
                  action="chevron"
                  onClick={() => props.onSelect(meta.id)}
                >
                  {recapTitle(meta)}
                </CategoryButton>
              )}
            </For>
          </CategoryButton.Group>
          <Row>
            <Button
              variant="text"
              size="sm"
              onPress={() => {
                if (confirm("Delete all stream recaps on this device?")) {
                  recaps.clear();
                }
              }}
            >
              Delete all recaps
            </Button>
          </Row>
        </Match>
      </Switch>
    </Column>
  );
}

function RecapDetail(props: { id: string; onBack: () => void }) {
  const [recap] = createResource(
    () => props.id,
    (id) => recaps.get(id),
  );

  return (
    <Column gap="lg">
      <Row>
        <Button variant="text" size="sm" onPress={props.onBack}>
          <Symbol>arrow_back</Symbol> All recaps
        </Button>
      </Row>
      <Switch>
        <Match when={recap.loading}>
          <CircularProgress />
        </Match>
        <Match when={!recap()}>
          <Text class="label">This recap no longer exists.</Text>
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

function RecapView(props: { recap: Recap; onDelete: () => void }) {
  const [hover, setHover] = createSignal<number>();

  const times = createMemo(() => props.recap.data.map((s) => s.t));

  const metrics = createMemo(() =>
    METRICS.filter(
      (m) =>
        (!m.only || m.only === props.recap.direction) &&
        props.recap.data.some((s) => typeof s[m.key] === "number"),
    ),
  );

  const tiles = createMemo(() => {
    const { summary, direction } = props.recap;
    const out: [string, string][] = [
      ["Duration", formatDuration(props.recap.endedAt - props.recap.startedAt)],
    ];

    if (summary.maxWidth)
      out.push(["Max resolution", `${summary.maxWidth}x${summary.maxHeight}`]);
    if (summary.avgBitrate !== undefined)
      out.push(["Avg bitrate", formatBitrate(summary.avgBitrate)]);
    if (summary.avgFps !== undefined)
      out.push(["Avg frame rate", `${summary.avgFps.toFixed(1)} fps`]);

    if (direction === "receiving") {
      out.push([
        "Freezes",
        `${summary.freezes} (${summary.frozenSeconds.toFixed(1)} s)`,
      ]);
      const packets = summary.received + summary.lost;
      out.push([
        "Packet loss",
        packets
          ? `${((summary.lost / packets) * 100).toFixed(2)}%`
          : String(summary.lost),
      ]);
    } else {
      out.push(["Packets lost (server)", String(summary.lost)]);
    }

    if (summary.avgRtt !== undefined)
      out.push([
        "Ping avg / max",
        `${Math.round(summary.avgRtt)} / ${Math.round(summary.maxRtt ?? 0)} ms`,
      ]);

    return out;
  });

  const info = () =>
    [
      ["Transport", props.recap.summary.transports.join(", ") || "-"],
      ["Codec", props.recap.info.codec ?? "-"],
      props.recap.direction === "sending"
        ? ["Encoder", props.recap.info.encoder ?? "-"]
        : ["Decoder", props.recap.info.decoder ?? "-"],
    ] as const;

  function downloadCsv() {
    const keys = METRICS.map((m) => m.key).filter((k) =>
      props.recap.data.some((s) => s[k] !== undefined),
    );
    if (props.recap.data.some((s) => s.limitation)) keys.push("limitation");

    const rows = [
      ["seconds", ...keys].join(","),
      ...props.recap.data.map((s) =>
        [(s.t / 1000).toFixed(1), ...keys.map((k) => s[k] ?? "")].join(","),
      ),
    ];

    const url = URL.createObjectURL(
      new Blob([rows.join("\n")], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `stream-recap-${new Date(props.recap.startedAt)
      .toISOString()
      .replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
        Hover a chart (or focus it and use the arrow keys) to read all values at
        the same moment.
      </Text>

      <Charts>
        <For each={metrics()}>
          {(metric) => (
            <TimeChart
              title={metric.title}
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
          Download CSV
        </Button>
        <Button
          variant="text"
          size="sm"
          onPress={() => {
            if (confirm("Delete this recap?")) props.onDelete();
          }}
        >
          Delete recap
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
      <Text class="label">What limited the stream quality</Text>
      <Strip>
        <For each={runs()}>
          {(run) => (
            <div
              title={`${limitationOf(run.reason).label}: ${run.count} s`}
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
              {limitationOf(reason).label}{" "}
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
