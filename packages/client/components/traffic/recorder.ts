import { isDesktopFile } from "./desktopRequests";
import { RingBuffer } from "./ringBuffer";
import type { NewEntry, TrafficEntry } from "./types";

/** Default number of entries kept before the oldest are dropped. */
export const DEFAULT_CAPACITY = 5000;

/** Entries kept for files the desktop app's session saw (images, fonts, ...). */
export const DESKTOP_FILE_CAPACITY = 1000;

/**
 * Approximate memory the recorded entries may take (bytes) before the oldest
 * are dropped, on top of the entry count cap. Entries are sized by
 * `estimateEntryBytes` (strings count two bytes a character), so this is a
 * rough guide, not an exact limit. 20 MB holds many thousands of typical
 * entries while keeping a long recording from slowing the app or a phone.
 */
export const BYTE_BUDGET = 20 * 1024 * 1024;

/** Memory budget (bytes) of the separate desktop file buffer. */
export const FILE_BYTE_BUDGET = 5 * 1024 * 1024;

/** Estimated bytes for the object itself and each of its fields. */
const OBJECT_OVERHEAD = 64;
const FIELD_OVERHEAD = 16;

/** How deep `estimateBytes` looks into nested values. */
const MAX_DEPTH = 6;

/**
 * Rough memory size of a value: two bytes per string character, eight per
 * number or boolean, plus a small overhead per object and field.
 *
 * @param value Any plain value
 * @param depth Current nesting level
 */
function estimateBytes(value: unknown, depth = 0): number {
  switch (typeof value) {
    case "string":
      return value.length * 2;
    case "number":
    case "boolean":
      return 8;
    case "object": {
      if (value === null || depth >= MAX_DEPTH) return 0;
      let total = OBJECT_OVERHEAD;
      // for...in: no array of values per object (this runs for every entry)
      for (const key in value) {
        total +=
          FIELD_OVERHEAD +
          estimateBytes((value as Record<string, unknown>)[key], depth + 1);
      }
      return total;
    }
    default:
      return 0;
  }
}

/**
 * Estimated memory an entry takes, from the lengths of its strings (URL,
 * headers, previews, frames) and its other fields.
 *
 * @param entry A recorded entry
 */
export function estimateEntryBytes(entry: TrafficEntry): number {
  return estimateBytes(entry);
}

/**
 * Framework-agnostic store behind the inspector: an on/off flag and a ring
 * buffer of raw (unredacted) entries. Wrappers check `enabled` first and call
 * `record`; the reactive layer subscribes with `subscribe`.
 */
export class TrafficRecorder {
  /** Whether wrappers should record. Off by default. */
  enabled = false;

  #buffer: RingBuffer<TrafficEntry>;
  /** Own budget for desktop file loads, so they can't push requests out. */
  #files: RingBuffer<TrafficEntry>;
  #nextId = 1;
  #nextConnectionId = 1;
  #listeners = new Set<() => void>();

  /**
   * @param capacity Maximum number of entries kept
   * @param maxBytes Approximate memory the entries may take
   * @param fileBytes Same, for the desktop file buffer
   */
  constructor(
    capacity = DEFAULT_CAPACITY,
    maxBytes = BYTE_BUDGET,
    fileBytes = FILE_BYTE_BUDGET,
  ) {
    this.#buffer = new RingBuffer(capacity, {
      maxBytes,
      sizeOf: estimateEntryBytes,
    });
    this.#files = new RingBuffer(DESKTOP_FILE_CAPACITY, {
      maxBytes: fileBytes,
      sizeOf: estimateEntryBytes,
    });
  }

  /**
   * Entries dropped to stay within the count and memory limits since the
   * recorder was created or last cleared.
   */
  get dropped(): number {
    return this.#buffer.dropped + this.#files.dropped;
  }

  /**
   * Store an entry and give it an id. Never throws.
   */
  record(entry: NewEntry) {
    try {
      const stored = { ...entry, id: this.#nextId++ } as TrafficEntry;
      if (stored.kind === "http" && isDesktopFile(stored))
        this.#files.push(stored);
      else this.#buffer.push(stored);
      for (const listener of this.#listeners) listener();
    } catch {
      // a failing recorder must never break the app
    }
  }

  /** A fresh id to link WebSocket events of one connection. */
  newConnectionId() {
    return this.#nextConnectionId++;
  }

  /** Entries from oldest to newest, unredacted. */
  snapshot(): TrafficEntry[] {
    const main = this.#buffer.toArray();
    const files = this.#files.toArray();
    if (!files.length) return main;
    // both lists are in id order: merge them back into one
    const out: TrafficEntry[] = [];
    let i = 0;
    let j = 0;
    while (i < main.length || j < files.length) {
      out.push(
        j >= files.length || (i < main.length && main[i].id < files[j].id)
          ? main[i++]
          : files[j++],
      );
    }
    return out;
  }

  /** Remove all entries. */
  clear() {
    this.#buffer.clear();
    this.#files.clear();
    for (const listener of this.#listeners) listener();
  }

  /**
   * Call `listener` after every change. Returns a function that unsubscribes.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
