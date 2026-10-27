import { RingBuffer } from "./ringBuffer";
import type { NewEntry, TrafficEntry } from "./types";

/** Default number of entries kept before the oldest are dropped. */
export const DEFAULT_CAPACITY = 5000;

/**
 * Framework-agnostic store behind the inspector: an on/off flag and a ring
 * buffer of raw (unredacted) entries. Wrappers check `enabled` first and call
 * `record`; the reactive layer subscribes with `subscribe`.
 */
export class TrafficRecorder {
  /** Whether wrappers should record. Off by default. */
  enabled = false;

  #buffer: RingBuffer<TrafficEntry>;
  #nextId = 1;
  #nextConnectionId = 1;
  #listeners = new Set<() => void>();

  /**
   * @param capacity Maximum number of entries kept
   */
  constructor(capacity = DEFAULT_CAPACITY) {
    this.#buffer = new RingBuffer(capacity);
  }

  /**
   * Store an entry and give it an id. Never throws.
   */
  record(entry: NewEntry) {
    try {
      this.#buffer.push({ ...entry, id: this.#nextId++ } as TrafficEntry);
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
    return this.#buffer.toArray();
  }

  /** Remove all entries. */
  clear() {
    this.#buffer.clear();
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
