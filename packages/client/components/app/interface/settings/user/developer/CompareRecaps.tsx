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

import { callRecaps } from "@revolt/rtc/callStats";
import {
  ParsedRecap,
  RecapKind,
  RecapLine,
  RecapRow,
  parseRecapCsv,
} from "@revolt/rtc/recapCsv";
import { Sample, recaps } from "@revolt/rtc/stats";
import { unzipFiles } from "@revolt/rtc/zip";
import { useState } from "@revolt/state";
import {
  Button,
  CategoryButton,
  CircularProgress,
  Column,
  Row,
  Text,
  TextField,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  CALL_METRICS,
  Metric as CallMetric,
  callContext,
  callTitle,
} from "./CallRecaps";
import { CompareChart, CompareSeries, Swatch } from "./CompareChart";
import { Charts, TileLabel } from "./RecapParts";
import {
  STREAM_METRICS,
  Metric as StreamMetric,
  recapContext,
  recapTitle,
} from "./StreamRecaps";
import { formatDuration } from "./TimeChart";

/**
 * Line colours in a fixed order, validated for colour vision deficiencies
 * as neighbours in both themes. A line keeps its colour while selected.
 */
const COLOURS = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#eb6834", dark: "#d95926" },
  { light: "#1baf7a", dark: "#199e70" },
  { light: "#eda100", dark: "#c98500" },
  { light: "#e87ba4", dark: "#d55181" },
  { light: "#008300", dark: "#008300" },
];

const MAX_LINES = COLOURS.length;

type Line = RecapLine & { id: string };

type Source = {
  id: string;
  name: string;
  origin: "mine" | "imported";
  kind: RecapKind;
  /** When and how long, for your own recaps */
  context?: string;
  lines: Line[];
};

type Metric = CallMetric | StreamMetric;

// kept while the app is open, so leaving the page doesn't lose imports
const [sources, setSources] = createSignal<Source[]>([]);
/** Selected line ids and their colour slot */
const [selected, setSelected] = createSignal<{ id: string; slot: number }[]>(
  [],
);
const [kind, setKind] = createSignal<RecapKind>("call");

let nextId = 0;
const newId = () => String(nextId++);

const percent = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Values to chart for a line, see {@link Metric.only} and `values` */
function metricValues(metric: Metric, line: Line) {
  if (metric.only && line.direction && metric.only !== line.direction) {
    return line.rows.map(() => undefined);
  }

  return "values" in metric && metric.values
    ? metric.values(line.rows as unknown as Sample[])
    : line.rows.map((r) => r[metric.key]);
}

/** Averages of on/off values read better as a share of the time */
function formatAverage(metric: Metric) {
  return metric.key === "frozen" ? percent : metric.format;
}

function addSource(source: Omit<Source, "id">) {
  const added = { ...source, id: newId() };
  setSources((list) => [...list, added]);
  setKind(added.kind);

  // start with our own microphone where there is one
  const first =
    added.lines.find((l) => l.direction === "sending") ?? added.lines[0];
  if (first) toggleLine(first.id, added.kind);
}

function removeSource(id: string) {
  const source = sources().find((s) => s.id === id);
  const lineIds = new Set(source?.lines.map((l) => l.id));
  setSelected((list) => list.filter((s) => !lineIds.has(s.id)));
  setSources((list) => list.filter((s) => s.id !== id));
}

function renameSource(id: string, name: string) {
  setSources((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));
}

/** Selected entries of one kind of recap */
function selectedOf(k: RecapKind) {
  const ids = new Set(
    sources()
      .filter((s) => s.kind === k)
      .flatMap((s) => s.lines.map((l) => l.id)),
  );
  return selected().filter((s) => ids.has(s.id));
}

function toggleLine(id: string, k: RecapKind) {
  if (selected().some((s) => s.id === id)) {
    setSelected((list) => list.filter((s) => s.id !== id));
    return;
  }

  const used = new Set(selectedOf(k).map((s) => s.slot));
  const slot = COLOURS.findIndex((_, i) => !used.has(i));
  if (slot === -1) return;
  setSelected((list) => [...list, { id, slot }]);
}

function toLines(lines: RecapLine[]): Line[] {
  return lines.map((l) => ({ ...l, id: newId() }));
}

/**
 * Add a recap CSV to the comparison
 * @param fileName File name, used as the recap's name
 * @param text File contents
 * @returns Error message if the file isn't a recap
 */
export function importRecapCsv(fileName: string, text: string) {
  const parsed: ParsedRecap | { error: string } = parseRecapCsv(text);
  if ("error" in parsed) return `${fileName}: ${parsed.error}`;

  addSource({
    name: fileName.replace(/\.csv$/i, ""),
    origin: "imported",
    kind: parsed.kind,
    lines: toLines(parsed.lines),
  });
}

function isZip(file: File) {
  return /\.zip$/i.test(file.name) || file.type.includes("zip");
}

/**
 * Add every recap CSV in a zip, like the ones several recaps export to
 * @param file Zip file
 * @returns Error messages
 */
async function importRecapZip(file: File) {
  let entries: Awaited<ReturnType<typeof unzipFiles>>;
  try {
    entries = await unzipFiles(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    return [
      `${file.name}: can't be read as a zip (${(err as Error).message}).`,
    ];
  }

  const decoder = new TextDecoder();
  const csvs = entries.filter((entry) => {
    const base = entry.name.split("/").pop() ?? "";
    // macOS adds hidden copies of every file when zipping
    return (
      /\.csv$/i.test(base) &&
      !base.startsWith("._") &&
      !entry.name.startsWith("__MACOSX/")
    );
  });

  if (!csvs.length) return [`${file.name}: there are no CSV files inside.`];

  return csvs.flatMap((entry) => {
    const failed = importRecapCsv(
      entry.name.split("/").pop()!,
      decoder.decode(entry.data),
    );
    return failed ? [failed] : [];
  });
}

/**
 * Compare your own recaps with recaps exported by others as CSV
 */
export function CompareRecaps() {
  const [error, setError] = createSignal<string[]>([]);
  const [picking, setPicking] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  async function importFiles(files: FileList | null) {
    const errors: string[] = [];
    for (const file of Array.from(files ?? [])) {
      if (isZip(file)) errors.push(...(await importRecapZip(file)));
      else {
        const failed = importRecapCsv(file.name, await file.text());
        if (failed) errors.push(failed);
      }
    }
    setError(errors);
    if (fileInput) fileInput.value = "";
  }

  const visibleSources = () => sources().filter((s) => s.kind === kind());
  const count = (k: RecapKind) => sources().filter((s) => s.kind === k).length;

  const state = useState();
  const palette = () =>
    Object.fromEntries(
      COLOURS.map((c, i) => [
        `--compare-${i}`,
        state.theme.activeTheme.darkMode ? c.dark : c.light,
      ]),
    );

  return (
    <Column gap="lg" style={palette()}>
      <Text class="body">
        Put your recaps next to recaps from other people. They open a recap in
        Voice Call Stats or Stream Stats and use Download CSV, or select several
        recaps and export them as one zip, then send you the file, which you
        import here. Everything stays on this device, and imports are kept until
        you close the app.
      </Text>

      <Row gap="sm" wrap>
        <Button
          size="sm"
          variant={kind() === "call" ? "filled" : "tonal"}
          onPress={() => setKind("call")}
        >
          Voice calls ({count("call")})
        </Button>
        <Button
          size="sm"
          variant={kind() === "stream" ? "filled" : "tonal"}
          onPress={() => setKind("stream")}
        >
          Streams ({count("stream")})
        </Button>
      </Row>

      <Row gap="sm" wrap>
        <Button size="sm" variant="tonal" onPress={() => fileInput?.click()}>
          <Symbol>upload_file</Symbol> Import CSV or zip
        </Button>
        <Button
          size="sm"
          variant={picking() ? "filled" : "tonal"}
          onPress={() => setPicking(!picking())}
        >
          <Symbol>add</Symbol> Add one of my recaps
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.zip,text/csv,application/zip"
          multiple
          hidden
          onChange={(e) => importFiles(e.currentTarget.files)}
        />
      </Row>

      <For each={error()}>
        {(message) => (
          <Text class="label">
            <ErrorText>{message}</ErrorText>
          </Text>
        )}
      </For>

      <Show when={picking()}>
        <MyRecaps kind={kind()} onAdded={() => setPicking(false)} />
      </Show>

      <Show
        when={visibleSources().length}
        fallback={
          <Text class="label">
            Nothing to compare yet. Import a CSV or add one of your own{" "}
            {kind() === "call" ? "call" : "stream"} recaps.
          </Text>
        }
      >
        <For each={visibleSources()}>
          {(source) => <SourceCard source={source} />}
        </For>
        <Comparison kind={kind()} />
      </Show>
    </Column>
  );
}

/**
 * Pick one of our own stored recaps
 */
function MyRecaps(props: { kind: RecapKind; onAdded: () => void }) {
  const [calls] = createResource(callRecaps.revision, () => callRecaps.list());
  const [streams] = createResource(recaps.revision, () => recaps.list());

  async function addCall(id: string) {
    const recap = await callRecaps.get(id);
    if (!recap) return;
    addSource({
      name: `${callTitle(recap)}, ${new Date(recap.startedAt).toLocaleDateString()}`,
      origin: "mine",
      kind: "call",
      context: callContext(recap),
      lines: toLines(
        recap.series.map((s) => ({
          label:
            s.direction === "sending"
              ? "Your microphone"
              : `${s.participantName} heard`,
          direction: s.direction,
          rows: s.data as unknown as RecapRow[],
        })),
      ),
    });
    props.onAdded();
  }

  async function addStream(id: string) {
    const recap = await recaps.get(id);
    if (!recap) return;
    addSource({
      name: `${recapTitle(recap)}, ${new Date(recap.startedAt).toLocaleDateString()}`,
      origin: "mine",
      kind: "stream",
      context: recapContext(recap),
      lines: toLines([
        {
          label: recapTitle(recap),
          direction: recap.direction,
          rows: recap.data as unknown as RecapRow[],
        },
      ]),
    });
    props.onAdded();
  }

  return (
    <Switch>
      <Match when={props.kind === "call"}>
        <Show when={!calls.loading} fallback={<CircularProgress />}>
          <Show
            when={calls()?.length}
            fallback={<Text class="label">You have no call recaps yet.</Text>}
          >
            <CategoryButton.Group>
              <For each={calls()}>
                {(meta) => (
                  <CategoryButton
                    icon={<Symbol>call</Symbol>}
                    description={callContext(meta)}
                    action={<Symbol>add</Symbol>}
                    onClick={() => addCall(meta.id)}
                  >
                    {callTitle(meta)}
                  </CategoryButton>
                )}
              </For>
            </CategoryButton.Group>
          </Show>
        </Show>
      </Match>
      <Match when={props.kind === "stream"}>
        <Show when={!streams.loading} fallback={<CircularProgress />}>
          <Show
            when={streams()?.length}
            fallback={<Text class="label">You have no stream recaps yet.</Text>}
          >
            <CategoryButton.Group>
              <For each={streams()}>
                {(meta) => (
                  <CategoryButton
                    icon={
                      <Symbol>
                        {meta.direction === "sending" ? "upload" : "live_tv"}
                      </Symbol>
                    }
                    description={recapContext(meta)}
                    action={<Symbol>add</Symbol>}
                    onClick={() => addStream(meta.id)}
                  >
                    {recapTitle(meta)}
                  </CategoryButton>
                )}
              </For>
            </CategoryButton.Group>
          </Show>
        </Show>
      </Match>
    </Switch>
  );
}

/**
 * One added recap: its name and which of its lines are compared
 */
function SourceCard(props: { source: Source }) {
  const slotOf = (id: string) => selected().find((s) => s.id === id)?.slot;
  const full = () => selectedOf(props.source.kind).length >= MAX_LINES;

  return (
    <Card>
      <Row gap="sm" align>
        <TileLabel>
          {props.source.origin === "mine" ? "Yours" : "Imported"}
        </TileLabel>
        <TextField
          label="Name"
          value={props.source.name}
          onChange={(e) => renameSource(props.source.id, e.currentTarget.value)}
        />
        <Button
          size="sm"
          variant="text"
          onPress={() => removeSource(props.source.id)}
        >
          Remove
        </Button>
      </Row>
      <Show when={props.source.context}>
        <TileLabel>{props.source.context}</TileLabel>
      </Show>
      <Row gap="sm" wrap>
        <For each={props.source.lines}>
          {(line) => (
            <Button
              size="sm"
              variant={slotOf(line.id) !== undefined ? "filled" : "tonal"}
              isDisabled={slotOf(line.id) === undefined && full()}
              onPress={() => toggleLine(line.id, props.source.kind)}
            >
              <Show when={slotOf(line.id) !== undefined}>
                <Swatch
                  style={{
                    background: colourOf(slotOf(line.id)!),
                    outline: "2px solid var(--md-sys-color-surface-container)",
                  }}
                />
              </Show>
              {line.label}
            </Button>
          )}
        </For>
      </Row>
      <Show when={full()}>
        <TileLabel>
          Up to {MAX_LINES} lines at once, deselect one to add another.
        </TileLabel>
      </Show>
    </Card>
  );
}

function colourOf(slot: number) {
  return `var(--compare-${slot})`;
}

/**
 * Table and charts of the selected lines
 */
function Comparison(props: { kind: RecapKind }) {
  const [hover, setHover] = createSignal<number>();

  const lines = createMemo(() =>
    selectedOf(props.kind).flatMap(({ id, slot }) => {
      for (const source of sources()) {
        const line = source.lines.find((l) => l.id === id);
        if (line) {
          return [
            {
              line,
              label: `${source.name}: ${line.label}`,
              colour: colourOf(slot),
            },
          ];
        }
      }
      return [];
    }),
  );

  const metrics = createMemo(() =>
    (props.kind === "call" ? CALL_METRICS : STREAM_METRICS)
      .map((metric) => ({
        metric,
        series: lines().map(
          ({ line, label, colour }): CompareSeries => ({
            id: line.id,
            label,
            color: colour,
            times: line.rows.map((r) => r.t),
            values: metricValues(metric, line),
          }),
        ),
      }))
      .filter(({ series }) =>
        series.some((s) => s.values.some((v) => typeof v === "number")),
      ),
  );

  const duration = createMemo(() =>
    Math.max(1, ...lines().map(({ line }) => line.rows.at(-1)?.t ?? 0)),
  );

  const average = (values: (number | undefined)[]) => {
    const defined = values.filter((v): v is number => v !== undefined);
    return defined.length
      ? defined.reduce((a, b) => a + b, 0) / defined.length
      : undefined;
  };

  return (
    <Show
      when={lines().length}
      fallback={
        <Text class="label">Select at least one line above to compare.</Text>
      }
    >
      <Palette>
        <Column gap="xs">
          <Text class="title">Averages</Text>
          <Text class="label">
            Recaps are lined up at the moment each one started.
          </Text>
        </Column>
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <th />
                <For each={lines()}>
                  {(l) => (
                    <th>
                      <HeadCell>
                        <Swatch style={{ background: l.colour }} />
                        {l.label}
                      </HeadCell>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Duration</td>
                <For each={lines()}>
                  {(l) => <td>{formatDuration(l.line.rows.at(-1)?.t ?? 0)}</td>}
                </For>
              </tr>
              <For each={metrics()}>
                {({ metric, series }) => (
                  <tr>
                    <td>{metric.title}</td>
                    <For each={series}>
                      {(s) => {
                        const avg = average(s.values);
                        return (
                          <td>
                            {avg !== undefined
                              ? formatAverage(metric)(avg)
                              : "-"}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </Table>
        </TableScroll>

        <Text class="label">
          Hover a chart (or focus it and use the arrow keys) to read every recap
          at the same moment.
        </Text>
        <Charts>
          <For each={metrics()}>
            {({ metric, series }) => (
              <CompareChart
                title={metric.title}
                series={series}
                format={metric.format}
                formatAverage={formatAverage(metric)}
                yTicks={metric.yTicks}
                duration={duration()}
                hover={hover()}
                onHover={setHover}
              />
            )}
          </For>
        </Charts>
      </Palette>
    </Show>
  );
}

const Palette = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-lg)",
  },
});

const Card = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
  },
});

const ErrorText = styled("span", {
  base: {
    color: "var(--md-sys-color-error)",
  },
});

const TableScroll = styled("div", {
  base: {
    overflowX: "auto",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
  },
});

const Table = styled("table", {
  base: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",
    fontVariantNumeric: "tabular-nums",

    "& th, & td": {
      padding: "var(--gap-sm) var(--gap-md)",
      textAlign: "start",
      whiteSpace: "nowrap",
    },
    "& th": {
      fontWeight: 600,
      verticalAlign: "bottom",
    },
    "& tbody tr": {
      borderTop: "1px solid var(--md-sys-color-outline-variant)",
    },
    "& td:first-child": {
      color: "var(--md-sys-color-on-surface-variant)",
      whiteSpace: "normal",
      minWidth: "160px",
    },
  },
});

const HeadCell = styled("span", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-xs)",
  },
});
