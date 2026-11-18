import { type PinRecord, type PinStore, MAX_PINS_PER_USER } from "./session";

/** Old localStorage key shared by all accounts of the profile; removed, not migrated. */
const LEGACY_STORAGE_KEY = "anytalk:e2ee:pins";

/** localStorage key that holds the pins of one account as JSON. */
export function pinStorageKey(ownerId: string): string {
  return `${LEGACY_STORAGE_KEY}:${ownerId}`;
}

/** The part of `Storage` the pin store needs. */
export interface PinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Reads the pins from storage; returns an empty map on any problem. */
function readPins(
  storage: PinStorage | undefined,
  key: string,
): Map<string, PinRecord[]> {
  const pins = new Map<string, PinRecord[]>();
  try {
    const data = JSON.parse(storage?.getItem(key) ?? "{}");
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
 * Pin store (trust on first use) of one account (`ownerId`, the logged in
 * user) that is kept in memory and written through
 * to `localStorage`. Every storage access is wrapped in try/catch, so a
 * blocked or full storage only means pins are not remembered across reloads.
 */
export function createPersistentPinStore(
  ownerId: string,
  storage: PinStorage | undefined = defaultStorage(),
): PinStore {
  const key = pinStorageKey(ownerId);
  const pins = readPins(storage, key);
  return {
    list: (userId) => pins.get(userId) ?? [],
    add: (userId, record) => {
      // other tabs may have pinned meanwhile: merge their pins before writing
      for (const [user, others] of readPins(storage, key)) {
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
        storage?.setItem(key, JSON.stringify(Object.fromEntries(pins)));
      } catch {
        // best effort
      }
    },
  };
}

/** Default storage: `localStorage`, or none where it does not exist. */
function defaultStorage(): PinStorage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** Deletes the pins of one account (on logout). Never throws. */
export function deletePins(
  ownerId: string,
  storage: PinStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.removeItem(pinStorageKey(ownerId));
  } catch {
    // blocked storage: nothing to delete
  }
}

/**
 * Deletes the old pins shared by all accounts of the profile. They are
 * dropped rather than adopted: they mix what several accounts saw, so
 * handing them to one account would leak which users the others called.
 * The cost is that peers are pinned again on first sight.
 */
export function deleteLegacyPins(
  storage: PinStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // blocked storage: nothing to delete
  }
}
