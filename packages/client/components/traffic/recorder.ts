import { isDesktopFile } from "./desktopRequests";
import { RingBuffer } from "./ringBuffer";
import type { NewEntry, TrafficEntry } from "./types";

/** Default number of entries kept before the oldest are dropped. */
export const DEFAULT_CAPACITY = 5000;

/** Entries kept for files the desktop app's session saw (images, fonts, ...). */
export const DESKTOP_FILE_CAPACITY = 1000;

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
  #files = new RingBuffer<TrafficEntry>(DESKTOP_FILE_CAPACITY);
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
