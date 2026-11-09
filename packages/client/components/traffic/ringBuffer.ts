/** Limits of a `RingBuffer` beyond its item count. */
export type RingBufferBudget<T> = {
  /** Total estimated size (bytes) the items may add up to. */
  maxBytes: number;
  /** Estimated size of one item in bytes. */
  sizeOf: (item: T) => number;
};

/** Size (bytes) assumed for an item whose `sizeOf` throws. */
const FALLBACK_ITEM_BYTES = 1024;

/**
 * Fixed-capacity buffer that drops the oldest item when full. It can also
 * keep to an approximate memory budget: when the estimated sizes of the items
 * add up to more than the budget, the oldest are dropped too (the newest item
 * is always kept, however large).
 */
export class RingBuffer<T> {
  #items: (T | undefined)[];
  #sizes: number[];
  #start = 0;
  #size = 0;
  #bytes = 0;
  #dropped = 0;

  /**
   * @param capacity Maximum number of items kept (at least 1)
   * @param budget Optional memory budget
   */
  constructor(
    readonly capacity: number,
    readonly budget?: RingBufferBudget<T>,
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.#items = new Array(this.capacity);
    this.#sizes = new Array(this.capacity).fill(0);
  }

  /** Number of items currently held. */
  get size() {
    return this.#size;
  }

  /** Estimated bytes of the items currently held (0 without a budget). */
  get bytes() {
    return this.#bytes;
  }

  /** Number of items dropped since creation or the last `clear`. */
  get dropped() {
    return this.#dropped;
  }

  /** Drop the oldest item. */
  #dropOldest() {
    this.#bytes -= this.#sizes[this.#start];
    this.#items[this.#start] = undefined;
    this.#sizes[this.#start] = 0;
    this.#start = (this.#start + 1) % this.capacity;
    this.#size--;
    this.#dropped++;
  }

  /**
   * Add an item, dropping the oldest ones when the buffer is full or over
   * its memory budget.
   */
  push(item: T) {
    if (this.#size >= this.capacity) this.#dropOldest();
    let size = 0;
    if (this.budget) {
      try {
        size = Math.max(0, this.budget.sizeOf(item)) || 0;
      } catch {
        // a failing estimate must not lose the entry
        size = FALLBACK_ITEM_BYTES;
      }
    }
    const index = (this.#start + this.#size) % this.capacity;
    this.#items[index] = item;
    this.#sizes[index] = size;
    this.#size++;
    this.#bytes += size;
    if (this.budget) {
      while (this.#size > 1 && this.#bytes > this.budget.maxBytes) {
        this.#dropOldest();
      }
    }
  }

  /**
   * Items from oldest to newest, as a new array.
   */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.#size; i++) {
      out.push(this.#items[(this.#start + i) % this.capacity] as T);
    }
    return out;
  }

  /** Remove everything and reset the dropped count. */
  clear() {
    this.#items = new Array(this.capacity);
    this.#sizes = new Array(this.capacity).fill(0);
    this.#start = 0;
    this.#size = 0;
    this.#bytes = 0;
    this.#dropped = 0;
  }
}
