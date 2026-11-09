import { type PinRecord, type PinStore, MAX_PINS_PER_USER } from "./session";

/** localStorage key that holds all pins as JSON. */
const STORAGE_KEY = "anytalk:e2ee:pins";

/** The part of `Storage` the pin store needs. */
export interface PinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads the pins from storage; returns an empty map on any problem. */
function readPins(storage: PinStorage | undefined): Map<string, PinRecord[]> {
  const pins = new Map<string, PinRecord[]>();
  try {
    const data = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    for (const [userId, list] of Object.entries(data)) {
      if (!Array.isArray(list)) continue;
      const records = list
        .filter((r) => r && typeof r.fingerprint === "string")
        .map(
          (r): PinRecord => ({
            fingerprint: r.fingerprint,
            ...(r.locked ? { locked: true } : {}),
          }),
        );
      pins.set(userId, records.slice(-MAX_PINS_PER_USER));
    }
  } catch {
    // unreadable storage: start without pins
  }
  return pins;
}

/**
 * Pin store (trust on first use) that is kept in memory and written through
 * to `localStorage`. Every storage access is wrapped in try/catch, so a
 * blocked or full storage only means pins are not remembered across reloads.
 */
export function createPersistentPinStore(
  storage: PinStorage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): PinStore {
  const pins = readPins(storage);
  return {
    list: (userId) => pins.get(userId) ?? [],
    add: (userId, record) => {
      // other tabs may have pinned meanwhile: merge their pins before writing
      for (const [user, others] of readPins(storage)) {
        const mine = pins.get(user) ?? [];
        const extra = others.filter(
          (o) => !mine.some((m) => m.fingerprint === o.fingerprint),
        );
        if (extra.length) {
          pins.set(user, [...extra, ...mine].slice(-MAX_PINS_PER_USER));
        }
      }
      const list = pins.get(userId) ?? [];
      if (list.some((p) => p.fingerprint === record.fingerprint)) return;
      pins.set(userId, [...list, record].slice(-MAX_PINS_PER_USER));
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(pins)));
      } catch {
        // best effort
      }
    },
  };
}
