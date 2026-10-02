import { For, Show, createMemo, createSignal, onMount } from "solid-js";

import { createResizeObserver } from "@solid-primitives/resize-observer";
import { styled } from "styled-system/jsx";

const HEIGHT = 140,
  MARGIN = { top: 10, right: 12, bottom: 22, left: 68 };

/** X tick spacing candidates, in seconds */
const TIME_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export function formatDuration(ms: number) {
  const total = Math.round(ms / 1000),
    h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Round up to 1, 2, 2.5 or 5 × 10^n */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * exp) return step * exp;
  }
  return 10 * exp;
}

/** Index of the sample closest to time t (times are ascending) */
function nearestIndex(times: number[], t: number) {
  let lo = 0,
    hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && t - times[lo - 1] < times[lo] - t ? lo - 1 : lo;
}

type Props = {
  title: string;
  times: number[];
  values: (number | undefined)[];
  format: (value: number) => string;
  /** Fixed y axis ticks; the highest one is the top of the chart */
  yTicks?: number[];
  /** Header text when nothing is hovered (defaults to the average) */
  summary?: string;
  /** Sample index under the shared crosshair */
  hover: number | undefined;
  onHover: (index: number | undefined) => void;
};

/**
 * Single-series line chart over time with a crosshair shared between charts
 */
export function TimeChart(props: Props) {
  let container: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(600);

  onMount(() =>
    createResizeObserver(container, ({ width }) => setWidth(width || 600)),
  );

  const plotWidth = () => Math.max(1, width() - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const duration = () => Math.max(1, props.times.at(-1) ?? 1);

  const yMax = createMemo(() =>
    props.yTicks
      ? Math.max(...props.yTicks)
      : niceMax(
          Math.max(
            0,
            ...props.values.filter((v): v is number => v !== undefined),
          ),
        ),
  );

  const x = (t: number) => MARGIN.left + (t / duration()) * plotWidth();
  const y = (v: number) => MARGIN.top + plotHeight - (v / yMax()) * plotHeight;

  /**
   * Line path, reduced to min/max per pixel column so spikes survive
   * long sessions; gaps (missing values) break the line
   */
  const paths = createMemo(() => {
    const columns = Math.max(1, Math.floor(plotWidth()));
    const segments: [number, number][][] = [];
    let current: [number, number][] = [];
    let bucket = -1,
      lo: [number, number] | undefined,
      hi: [number, number] | undefined;

    const flush = () => {
      if (!lo || !hi) return;
      const pts = lo[0] <= hi[0] ? [lo, hi] : [hi, lo];
      current.push(...(lo === hi ? [lo] : pts));
      lo = hi = undefined;
    };

    props.times.forEach((t, i) => {
      const v = props.values[i];
      if (v === undefined) {
        flush();
        if (current.length) segments.push(current);
        current = [];
        bucket = -1;
        return;
      }

      const b = Math.floor((t / duration()) * columns);
      if (b !== bucket) {
        flush();
        bucket = b;
      }

      const p: [number, number] = [x(t), y(v)];
      if (!lo || p[1] > lo[1]) lo = p;
      if (!hi || p[1] < hi[1]) hi = p;
    });

    flush();
    if (current.length) segments.push(current);

    const baseline = y(0);
    return segments.map((pts) => ({
      line: pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(""),
      area:
        `M${pts[0][0]},${baseline}` +
        pts.map(([px, py]) => `L${px},${py}`).join("") +
        `L${pts.at(-1)![0]},${baseline}Z`,
    }));
  });

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

  const hovered = () => {
    const i = props.hover;
    if (i === undefined || i >= props.times.length) return undefined;
    return { t: props.times[i], v: props.values[i] };
  };

  /** Summary shown in the header when nothing is hovered */
  const average = createMemo(() => {
    const values = props.values.filter((v): v is number => v !== undefined);
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : undefined;
  });

  function onPointerMove(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const t =
      ((e.clientX - rect.left - MARGIN.left) / plotWidth()) * duration();
    props.onHover(
      nearestIndex(props.times, Math.min(Math.max(t, 0), duration())),
    );
  }

  function onKeyDown(e: KeyboardEvent) {
    const last = props.times.length - 1;
    const step = e.shiftKey ? 10 : 1;
    const current = props.hover ?? 0;
    if (e.key === "ArrowRight") props.onHover(Math.min(last, current + step));
    else if (e.key === "ArrowLeft") props.onHover(Math.max(0, current - step));
    else if (e.key === "Home") props.onHover(0);
    else if (e.key === "End") props.onHover(last);
    else return;
    e.preventDefault();
  }

  return (
    <Card>
      <Header>
        <span>{props.title}</span>
        <Readout>
          <Show
            when={hovered()}
            fallback={
              <Show
                when={props.summary === undefined}
                fallback={<Muted>{props.summary}</Muted>}
              >
                <Show when={average() !== undefined}>
                  <Muted>avg </Muted>
                  {props.format(average()!)}
                </Show>
              </Show>
            }
          >
            {(h) => (
              <>
                <strong>
                  {h().v !== undefined ? props.format(h().v!) : "no data"}
                </strong>
                <Muted> at {formatDuration(h().t)}</Muted>
              </>
            )}
          </Show>
        </Readout>
      </Header>
      <div ref={container}>
        <svg
          width={width()}
          height={HEIGHT}
          role="img"
          aria-label={`${props.title} over time`}
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
          <For each={paths()}>
            {(path) => (
              <>
                <path
                  d={path.area}
                  fill="var(--md-sys-color-primary)"
                  fill-opacity="0.1"
                />
                <path
                  d={path.line}
                  fill="none"
                  stroke="var(--md-sys-color-primary)"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </>
            )}
          </For>
          <Show when={hovered()}>
            {(h) => (
              <>
                <line
                  x1={x(h().t)}
                  x2={x(h().t)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotHeight}
                  stroke="var(--md-sys-color-on-surface-variant)"
                  stroke-width="1"
                />
                <Show when={h().v !== undefined}>
                  <circle
                    cx={x(h().t)}
                    cy={y(h().v!)}
                    r="4"
                    fill="var(--md-sys-color-primary)"
                    stroke="var(--md-sys-color-surface-container)"
                    stroke-width="2"
                  />
                </Show>
              </>
            )}
          </Show>
        </svg>
      </div>
    </Card>
  );
}

const Card = styled("div", {
  base: {
    minWidth: 0,
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",
  },
});

const Header = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "var(--gap-md)",
    marginBottom: "var(--gap-sm)",
    fontSize: "13px",
    fontWeight: 600,
  },
});

const Readout = styled("span", {
  base: {
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
});

const Muted = styled("span", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
