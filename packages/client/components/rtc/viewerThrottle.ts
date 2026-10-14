/** Most identities kept from one "watching" message */
export const MAX_WATCHING = 50;

/** Shortest time between two applied "watching" messages of one sender */
export const WATCH_MIN_INTERVAL_MS = 250;

/**
 * Quiet time before viewer changes count as settled. A sustained flood keeps
 * the gate unsettled, so a real join stays silent until it stops (accepted)
 */
export const VIEWER_SETTLE_MS = 1000;

/** Shortest time between two viewer sounds */
export const VIEWER_SOUND_GAP_MS = 500;

/**
 * Clean up a received list of watched streams: strings only, only
 * participants currently in the room, no duplicates, at most `max` entries
 *
 * @param list Untrusted value from a data message
 * @param inRoom Whether an identity belongs to someone in the room
 * @param max Most entries to keep
 * @returns The cleaned list
 */
export function sanitizeWatching(
  list: unknown[],
  inRoom: (identity: string) => boolean,
  max = MAX_WATCHING,
): string[] {
  const result = new Set<string>();
  for (const identity of list) {
    if (result.size >= max) break;
    if (typeof identity === "string" && inRoom(identity)) result.add(identity);
  }
  return [...result];
}

/**
 * Apply at most one value per interval for each key. Values arriving too
 * fast are held back, and the latest one is applied once the interval is over
 * (trailing apply), so the final state is never lost.
 *
 * @param interval Shortest time between two applies of one key (ms)
 * @param apply Called with the key and value to apply
 * @returns `push` to offer a value, `clear` to forget a key, `dispose` to
 * forget all
 */
export function createKeyedThrottle<T>(
  interval: number,
  apply: (key: string, value: T) => void,
) {
  const entries = new Map<
    string,
    { last: number; timer?: ReturnType<typeof setTimeout>; pending?: { v: T } }
  >();

  return {
    /** Offer a value for a key, it is applied now or after the interval */
    push(key: string, value: T) {
      const now = Date.now();
      const entry = entries.get(key);

      if (!entry || (!entry.timer && now - entry.last >= interval)) {
        entries.set(key, { last: now });
        apply(key, value);
        return;
      }

      // too soon: keep only the latest, a timer applies it
      entry.pending = { v: value };
      if (entry.timer) return;
      entry.timer = setTimeout(
        () => {
          entry.timer = undefined;
          entry.last = Date.now();
          const pending = entry.pending;
          entry.pending = undefined;
          if (pending) apply(key, pending.v);
        },
        Math.max(0, entry.last + interval - now),
      );
    },

    /** Forget a key and drop what was held back for it */
    clear(key: string) {
      const entry = entries.get(key);
      if (entry?.timer) clearTimeout(entry.timer);
      entries.delete(key);
    },

    /** Forget every key */
    dispose() {
      for (const entry of entries.values()) clearTimeout(entry.timer);
      entries.clear();
    },
  };
}

/**
 * Turn changes of the viewer list into at most one sound per settle window:
 * a sound is only played once the list stayed unchanged for `settle` ms, and
 * only if it differs from the last settled list (someone who flips back
 * within the window makes no sound). Sounds are at least `gap` ms apart.
 *
 * @param options.onSound Plays the sound for a settled change
 * @param options.shouldAnnounceLeave Whether a viewer that went away counts
 * (e.g. not when they left the call, that has its own sound)
 * @returns `update` with the current viewers, `reset` to take a list as
 * settled without a sound, `dispose` to cancel
 */
export function createViewerSoundGate(options: {
  onSound: (kind: "join" | "leave") => void;
  shouldAnnounceLeave?: (identity: string) => boolean;
  settle?: number;
  gap?: number;
}) {
  const settle = options.settle ?? VIEWER_SETTLE_MS;
  const gap = options.gap ?? VIEWER_SOUND_GAP_MS;

  let settled = new Set<string>();
  let current = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSound = -Infinity;

  return {
    /** The viewers changed, sound for it once they stay put */
    update(viewers: Iterable<string>) {
      current = new Set(viewers);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const joined = [...current].some((id) => !settled.has(id));
        const left = [...settled].some(
          (id) =>
            !current.has(id) && (options.shouldAnnounceLeave?.(id) ?? true),
        );
        settled = current;

        if (!joined && !left) return;
        const now = Date.now();
        if (now - lastSound < gap) return;
        lastSound = now;
        options.onSound(joined ? "join" : "leave");
      }, settle);
    },

    /** Take these viewers as settled, without a sound */
    reset(viewers: Iterable<string> = []) {
      clearTimeout(timer);
      timer = undefined;
      settled = new Set(viewers);
      current = settled;
    },

    /** Cancel a sound that is waiting */
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
