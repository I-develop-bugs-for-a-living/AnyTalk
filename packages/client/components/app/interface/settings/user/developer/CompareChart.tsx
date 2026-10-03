import { For, Show, createMemo, createSignal, onMount } from "solid-js";

import { createResizeObserver } from "@solid-primitives/resize-observer";
import { styled } from "styled-system/jsx";

import {
  Card,
  HEIGHT,
  Header,
  MARGIN,
  Muted,
  Readout,
  TIME_STEPS,
  formatDuration,
  linePaths,
  nearestIndex,
  niceMax,
} from "./TimeChart";

/** Hovered samples further than this from the crosshair show no value */
const MAX_HOVER_GAP_MS = 1500;

export type CompareSeries = {
  id: string;
  label: string;
  color: string;
  times: number[];
  values: (number | undefined)[];
};

type Props = {
  title: string;
  series: CompareSeries[];
  format: (value: number) => string;
  /** Format of the averages in the legend (defaults to format) */
  formatAverage?: (value: number) => string;
  /** Fixed y axis ticks; the highest one is the top of the chart */
  yTicks?: number[];
  /** Time under the crosshair shared between charts, ms from the start */
  hover: number | undefined;
  onHover: (t: number | undefined) => void;
  /** Longest series, so every chart shares the same time axis */
  duration: number;
};

function average(values: (number | undefined)[]) {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length
    ? defined.reduce((a, b) => a + b, 0) / defined.length
    : undefined;
}

/**
 * Line chart of several recaps over time since each one started, with a
 * crosshair shared between charts and a legend that reads out the values
 */
export function CompareChart(props: Props) {
  let container: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(600);

  onMount(() =>
    createResizeObserver(container, ({ width }) => setWidth(width || 600)),
  );

  const plotWidth = () => Math.max(1, width() - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const duration = () => Math.max(1, props.duration);

  const yMax = createMemo(() =>
    props.yTicks
      ? Math.max(...props.yTicks)
      : niceMax(
          Math.max(
            0,
            ...props.series.flatMap((s) =>
              s.values.filter((v): v is number => v !== undefined),
            ),
          ),
        ),
  );

  const x = (t: number) => MARGIN.left + (t / duration()) * plotWidth();
  const y = (v: number) => MARGIN.top + plotHeight - (v / yMax()) * plotHeight;

  const lines = createMemo(() =>
    props.series.map((s) => ({
      series: s,
      paths: linePaths(s.times, s.values, {
        x,
        y,
        columns: Math.max(1, Math.floor(plotWidth())),
        duration: duration(),
      }),
    })),
  );

  const xTicks = createMemo(() => {
    const seconds = duration() / 1000;
    const step =
      TIME_STEPS.find((s) => seconds / s <= Math.max(2, plotWidth() / 90)) ??
      3600;
    const ticks: number[] = [];
    for (let s = 0; s <= seconds; s += step) ticks.push(s * 1000);
    return ticks;
  });

  const yTicks = () => props.yTicks ?? [0, yMax() / 2, yMax()];

  /** Each series' value at the crosshair, if it has a sample close to it */
  const valueAt = (s: CompareSeries, t: number) => {
    if (!s.times.length) return undefined;
    const i = nearestIndex(s.times, t);
    if (Math.abs(s.times[i] - t) > MAX_HOVER_GAP_MS) return undefined;
    const v = s.values[i];
    return v === undefined ? undefined : { t: s.times[i], v };
  };

  const averages = createMemo(() => props.series.map((s) => average(s.values)));

  function onPointerMove(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const t =
      ((e.clientX - rect.left - MARGIN.left) / plotWidth()) * duration();
    props.onHover(Math.min(Math.max(t, 0), duration()));
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = (e.shiftKey ? 10 : 1) * 1000;
    const current = props.hover ?? 0;
    if (e.key === "ArrowRight")
      props.onHover(Math.min(duration(), current + step));
    else if (e.key === "ArrowLeft") props.onHover(Math.max(0, current - step));
    else if (e.key === "Home") props.onHover(0);
    else if (e.key === "End") props.onHover(duration());
    else return;
    e.preventDefault();
  }

  return (
    <Card>
      <Header>
        <span>{props.title}</span>
        <Readout>
          <Show
            when={props.hover !== undefined}
            fallback={<Muted>avg per recap</Muted>}
          >
            <Muted>at {formatDuration(props.hover!)}</Muted>
          </Show>
        </Readout>
      </Header>
      <div ref={container}>
        <svg
          width={width()}
          height={HEIGHT}
          role="img"
          aria-label={`${props.title} over time, ${props.series.length} recaps`}
          tabindex="0"
          onPointerMove={onPointerMove}
          onPointerLeave={() => props.onHover(undefined)}
          onKeyDown={onKeyDown}
          onBlur={() => props.onHover(undefined)}
          style={{ display: "block", outline: "none", "touch-action": "none" }}
        >
          <For each={yTicks()}>
            {(tick) => (
              <>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth()}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--md-sys-color-outline-variant)"
                  stroke-width="1"
                />
                <text
                  x={MARGIN.left - 6}
                  y={y(tick)}
                  text-anchor="end"
                  dominant-baseline="middle"
                  fill="var(--md-sys-color-on-surface-variant)"
                  font-size="11"
                  style={{ "font-variant-numeric": "tabular-nums" }}
                >
                  {props.format(tick)}
                </text>
              </>
            )}
          </For>
          <For each={xTicks()}>
            {(tick) => (
              <text
                x={x(tick)}
                y={HEIGHT - 6}
                text-anchor="middle"
                fill="var(--md-sys-color-on-surface-variant)"
                font-size="11"
                style={{ "font-variant-numeric": "tabular-nums" }}
              >
                {formatDuration(tick)}
              </text>
            )}
          </For>
          <For each={lines()}>
            {(line) => (
              <For each={line.paths}>
                {(path) => (
                  <path
                    d={path.line}
                    fill="none"
                    stroke={line.series.color}
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                )}
              </For>
            )}
          </For>
          <Show when={props.hover !== undefined}>
            <line
              x1={x(props.hover!)}
              x2={x(props.hover!)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke="var(--md-sys-color-on-surface-variant)"
              stroke-width="1"
            />
            <For each={props.series}>
              {(s) => (
                <Show when={valueAt(s, props.hover!)}>
                  {(point) => (
                    <circle
                      cx={x(point().t)}
                      cy={y(point().v)}
                      r="4"
                      fill={s.color}
                      stroke="var(--md-sys-color-surface-container)"
                      stroke-width="2"
                    />
                  )}
                </Show>
              )}
            </For>
          </Show>
        </svg>
      </div>
      <Legend>
        <For each={props.series}>
          {(s, i) => {
            const value = () =>
              props.hover !== undefined
                ? valueAt(s, props.hover)?.v
                : averages()[i()];
            const format = (v: number) =>
              props.hover === undefined && props.formatAverage
                ? props.formatAverage(v)
                : props.format(v);
            return (
              <LegendItem>
                <Swatch style={{ background: s.color }} />
                <LegendLabel>{s.label}</LegendLabel>
                <strong>
                  {value() !== undefined ? format(value()!) : "-"}
                </strong>
              </LegendItem>
            );
          }}
        </For>
      </Legend>
    </Card>
  );
}

const Legend = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--gap-xs) var(--gap-md)",
    marginTop: "var(--gap-sm)",
    fontSize: "12px",
    color: "var(--md-sys-color-on-surface)",
    fontVariantNumeric: "tabular-nums",
  },
});

const LegendItem = styled("span", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-xs)",
    minWidth: 0,
  },
});

const LegendLabel = styled("span", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "180px",
  },
});

export const Swatch = styled("span", {
  base: {
    flexShrink: 0,
    width: "10px",
    height: "10px",
    borderRadius: "var(--borderRadius-full)",
  },
});
