import { createSignal, onCleanup } from "solid-js";

/**
 * Format an elapsed duration as `m:ss` (under an hour) or `h:mm:ss`
 * @param ms Elapsed milliseconds, negative values count as zero
 */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Work out the start of a channel's occupancy. The start only ever moves
 * earlier while the channel stays occupied, so it doesn't jump when the oldest
 * participant leaves.
 * @param previous Start tracked so far, if the channel was already occupied
 * @param joinedAts Join times (ms) of the current participants, may hold NaN
 * @param now Current time (ms), used when no join time is valid
 * @returns The new start in ms
 */
export function nextOccupancyStart(
  previous: number | undefined,
  joinedAts: number[],
  now: number,
): number {
  const valid = joinedAts.filter((t) => Number.isFinite(t));
  const candidate = valid.length ? Math.min(...valid) : undefined;
  if (previous === undefined) return candidate ?? now;
  return candidate === undefined ? previous : Math.min(previous, candidate);
}

/** Tracked start per occupied channel id (ms) */
const starts = new Map<string, number>();

/**
 * Update and return the tracked start of a channel
 * @param channelId Channel id
 * @param joinedAts Join times (ms) of the current participants
 * @param now Current time (ms)
 * @returns Start in ms, or undefined (and forgotten) when nobody is in it
 */
export function trackOccupancy(
  channelId: string,
  joinedAts: number[],
  now: number = Date.now(),
): number | undefined {
  if (joinedAts.length === 0) {
    starts.delete(channelId);
    return undefined;
  }
  const start = nextOccupancyStart(starts.get(channelId), joinedAts, now);
  starts.set(channelId, start);
  return start;
}

/** Number of mounted timers per channel id */
const mountCounts = new Map<string, number>();

/**
 * Register a mounted timer for a channel. When the last timer of a channel
 * unmounts, its tracked start is forgotten, so a later session doesn't reuse
 * a stale start. Call inside a reactive owner.
 * @param channelId Channel id
 */
export function useOccupancyMount(channelId: string): void {
  mountCounts.set(channelId, (mountCounts.get(channelId) ?? 0) + 1);
  onCleanup(() => releaseOccupancyMount(channelId));
}

/**
 * Unregister a timer of a channel, forgetting its start with the last one
 * @param channelId Channel id
 */
export function releaseOccupancyMount(channelId: string): void {
  const left = (mountCounts.get(channelId) ?? 1) - 1;
  if (left > 0) {
    mountCounts.set(channelId, left);
  } else {
    mountCounts.delete(channelId);
    starts.delete(channelId);
  }
}

const [now, setNow] = createSignal(Date.now());
let mounted = 0;
let interval: ReturnType<typeof setInterval> | undefined;

/**
 * Shared one-second clock for all timers. The interval runs only while at
 * least one caller is mounted. Call inside a reactive owner.
 * @returns Accessor for the current time in ms
 */
export function useSharedNow(): () => number {
  mounted++;
  setNow(Date.now());
  if (!interval) interval = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => {
    if (--mounted === 0 && interval) {
      clearInterval(interval);
      interval = undefined;
    }
  });
  return now;
}
