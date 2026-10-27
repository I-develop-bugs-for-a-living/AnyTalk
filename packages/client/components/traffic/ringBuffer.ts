/**
 * Fixed-capacity buffer that drops the oldest item when full.
 */
export class RingBuffer<T> {
  #items: (T | undefined)[];
  #start = 0;
  #size = 0;

  /**
   * @param capacity Maximum number of items kept (at least 1)
   */
  constructor(readonly capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.#items = new Array(this.capacity);
  }

  /** Number of items currently held. */
  get size() {
    return this.#size;
  }

  /**
   * Add an item, dropping the oldest one when full.
   */
  push(item: T) {
    if (this.#size < this.capacity) {
      this.#items[(this.#start + this.#size) % this.capacity] = item;
      this.#size++;
    } else {
      this.#items[this.#start] = item;
      this.#start = (this.#start + 1) % this.capacity;
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

  /** Remove everything. */
  clear() {
    this.#items = new Array(this.capacity);
    this.#start = 0;
    this.#size = 0;
  }
}
