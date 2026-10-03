import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";

import {
  AudioSample,
  AudioSummary,
  CallRecap,
  CallRecapMeta,
  CallSeries,
  callRecaps,
} from "@revolt/rtc/callStats";
import { Direction, formatBitrate } from "@revolt/rtc/stats";
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

export type Metric = {
  key: keyof AudioSample;
  title: string;
  format: (v: number) => string;
  only?: Direction;
  yTicks?: number[];
};

const int = (v: number) => String(Math.round(v * 10) / 10);
const ms = (v: number) => `${Math.round(v)} ms`;
const percent = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * Charted values, in display order; charts without data are skipped
 */
export const CALL_METRICS: Metric[] = [
  { key: "bitrate", title: "Bitrate", format: formatBitrate },
  { key: "packets", title: "Packets per second", format: int },
  {
    key: "lost",
    title: "Packets lost per second",
    format: int,
  },
  {
    key: "concealed",
    title: "Concealed audio (made up to hide lost packets)",
    format: percent,
    only: "receiving",
  },
  { key: "jitter", title: "Jitter", format: ms },
  {
    key: "jitterBuffer",
    title: "Jitter buffer delay",
    format: ms,
    only: "receiving",
  },
  { key: "rtt", title: "Ping (round trip to the server)", format: ms },
  { key: "level", title: "Audio level", format: percent },
  {
    key: "quality",
    title: "Connection quality (rated by the server)",
    format: (v) => ["Lost", "Poor", "Good", "Excellent"][Math.round(v)] ?? "-",
    yTicks: [0, 1, 2, 3],
  },
  {
    key: "available",
    title: "Estimated upload bandwidth",
    format: formatBitrate,
    only: "sending",
  },
];

export function callTitle(meta: CallRecapMeta) {
  return meta.channelName ? `#${meta.channelName}` : "Call";
}

export function callContext(meta: CallRecapMeta) {
  return [
    new Date(meta.startedAt).toLocaleString(),
    formatDuration(meta.endedAt - meta.startedAt),
    meta.serverName,
    meta.participants.length
      ? `with ${meta.participants.join(", ")}`
      : "nobody else",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A call recap as CSV, one row per microphone and second
 * @param recap Recap
 * @returns File name and contents
 */
export function callRecapCsv(recap: CallRecap): RecapCsv {
  const keys = CALL_METRICS.map((m) => m.key).filter((k) =>
    recap.series.some((s) => s.data.some((d) => d[k] !== undefined)),
  );

  const rows = [
    ["participant", "direction", "seconds", ...keys].join(","),
    ...recap.series.flatMap((s) =>
      s.data.map((d) =>
        [
          JSON.stringify(s.participantName),
          s.direction,
          (d.t / 1000).toFixed(1),
          ...keys.map((k) => d[k] ?? ""),
        ].join(","),
      ),
    ),
  ];

  return {
    name: `call-recap-${new Date(recap.startedAt)
      .toISOString()
      .replace(/[:.]/g, "-")}.csv`,
    text: rows.join("\n"),
  };
}

/**
 * Voice call recaps (voice developer mode)
 */
export function CallRecaps() {
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
  const [list] = createResource(callRecaps.revision, () => callRecaps.list());

  async function exportRecaps(ids: string[]) {
    const found = await Promise.all(ids.map((id) => callRecaps.get(id)));
    downloadRecapCsvs(
      found.filter((r) => r !== null).map(callRecapCsv),
      `call-recaps-${new Date().toISOString().slice(0, 10)}.zip`,
    );
  }

  return (
    <Column gap="lg">
      <Text class="body">
        While voice call developer mode and "Record call recaps" are on, your
        microphone and everyone you hear are measured once per second. Recaps
        are stored on this device only; the newest 20 calls are kept.
      </Text>
      <Switch>
        <Match when={list.loading}>
          <CircularProgress />
        </Match>
        <Match when={!list()?.length}>
          <Text class="label">
            No recaps yet. Turn on "Record call recaps", then join a call.
          </Text>
        </Match>
        <Match when={list()?.length}>
          <SelectableRecapList
            items={list()!}
            noun="call"
            icon={() => <Symbol>call</Symbol>}
            title={callTitle}
            description={(meta) =>
              `${callContext(meta)}${
                meta.worstIncomingLoss
                  ? ` · up to ${percent(meta.worstIncomingLoss)} loss`
                  : ""
              }`
            }
            onOpen={props.onSelect}
            onExport={exportRecaps}
            onDelete={(ids) => callRecaps.removeMany(ids)}
            onDeleteAll={() => {
              if (confirm("Delete all call recaps on this device?")) {
                callRecaps.clear();
              }
            }}
          />
        </Match>
      </Switch>
    </Column>
  );
}

function RecapDetail(props: { id: string; onBack: () => void }) {
  const [recap] = createResource(
    () => props.id,
    (id) => callRecaps.get(id),
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
              onDelete={() => callRecaps.remove(r().id).then(props.onBack)}
            />
          )}
        </Match>
      </Switch>
    </Column>
  );
}

function summaryTiles(summary: AudioSummary): [string, string][] {
  const out: [string, string][] = [];
  if (summary.avgBitrate !== undefined)
    out.push(["Avg bitrate", formatBitrate(summary.avgBitrate)]);
  if (summary.loss !== undefined)
    out.push(["Packet loss", percent(summary.loss)]);
  if (summary.concealed !== undefined)
    out.push(["Concealed audio", percent(summary.concealed)]);
  if (summary.avgJitter !== undefined)
    out.push([
      "Jitter avg / max",
      `${Math.round(summary.avgJitter)} / ${Math.round(summary.maxJitter ?? 0)} ms`,
    ]);
  if (summary.poorConnection !== undefined)
    out.push(["Poor or lost connection", percent(summary.poorConnection)]);
  if (summary.avgRtt !== undefined)
    out.push([
      "Ping avg / max",
      `${Math.round(summary.avgRtt)} / ${Math.round(summary.maxRtt ?? 0)} ms`,
    ]);
  return out;
}

function RecapView(props: { recap: CallRecap; onDelete: () => void }) {
  const outgoing = () =>
    props.recap.series.filter((s) => s.direction === "sending");
  const incoming = () =>
    props.recap.series.filter((s) => s.direction === "receiving");

  const [selected, setSelected] = createSignal<string>();
  const current = createMemo(
    () => incoming().find((s) => s.key === selected()) ?? incoming()[0],
  );

  const info = () =>
    [
      ["Transport", props.recap.transport ?? "-"],
      ["Codec", props.recap.series.find((s) => s.codec)?.codec ?? "-"],
    ] as const;

  function downloadCsv() {
    const csv = callRecapCsv(props.recap);
    downloadRecapCsvs([csv], csv.name);
  }

  return (
    <>
      <Column gap="xs">
        <Text class="title" size="large">
          {callTitle(props.recap)}
        </Text>
        <Text class="label">{callContext(props.recap)}</Text>
      </Column>

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

      <Text class="label">
        Hover a chart (or focus it and use the arrow keys) to read all values at
        the same moment.
      </Text>

      <Show when={outgoing().length}>
        <Column>
          <Text class="title">Your microphone (outgoing)</Text>
          <Text class="label">
            Loss and jitter are what the server reports about the audio it got
            from you.
          </Text>
        </Column>
        <For each={outgoing()}>
          {(series) => <SeriesView series={series} />}
        </For>
      </Show>

      <Show when={incoming().length}>
        <Column>
          <Text class="title">Incoming</Text>
          <Text class="label">How everyone else's audio reached you.</Text>
        </Column>
        <Show when={incoming().length > 1}>
          <Row gap="sm" wrap>
            <For each={incoming()}>
              {(series) => (
                <Button
                  size="sm"
                  variant={current()?.key === series.key ? "filled" : "tonal"}
                  onPress={() => setSelected(series.key)}
                >
                  {series.participantName}
                </Button>
              )}
            </For>
          </Row>
        </Show>
        <Show when={current()} keyed>
          {(series) => <SeriesView series={series} />}
        </Show>
      </Show>

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
 * Summary and charts of one microphone
 */
function SeriesView(props: { series: CallSeries }) {
  const [hover, setHover] = createSignal<number>();

  const times = createMemo(() => props.series.data.map((s) => s.t));
  const metrics = createMemo(() =>
    CALL_METRICS.filter(
      (m) =>
        (!m.only || m.only === props.series.direction) &&
        props.series.data.some((s) => typeof s[m.key] === "number"),
    ),
  );

  return (
    <>
      <Tiles>
        <For each={summaryTiles(props.series.summary)}>
          {([label, value]) => (
            <Tile>
              <TileLabel>{label}</TileLabel>
              <TileValue>{value}</TileValue>
            </Tile>
          )}
        </For>
      </Tiles>
      <Charts>
        <For each={metrics()}>
          {(metric) => (
            <TimeChart
              title={metric.title}
              times={times()}
              values={props.series.data.map(
                (s) => s[metric.key] as number | undefined,
              )}
              format={metric.format}
              yTicks={metric.yTicks}
              hover={hover()}
              onHover={setHover}
            />
          )}
        </For>
      </Charts>
    </>
  );
}
