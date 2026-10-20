/** Maximum number of channels searched at the same time. */
export const SERVER_SEARCH_CONCURRENCY = 6;

/** Maximum number of results requested from each channel. */
export const SERVER_SEARCH_PER_CHANNEL = 25;

/** Maximum number of merged results that are shown. */
export const SERVER_SEARCH_LIMIT = 50;

/**
 * Run a task for every item with at most `limit` tasks in flight.
 * Failed tasks are counted and skipped, so one rejected channel (403 etc.)
 * doesn't fail the whole search.
 * @param items Items to process
 * @param limit Maximum number of concurrent tasks
 * @param task Async function run for each item
 * @param onProgress Called after each item finished (done, total)
 * @param signal Stops workers from picking up new items once aborted
 * @returns Results of the tasks that succeeded (in completion order) and the
 * number of tasks that failed
 */
export async function runLimited<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ results: R[]; failed: number }> {
  const results: R[] = [];
  let failed = 0;
  let next = 0;
  let done = 0;

  /** Take items off the queue until it is empty or the run is aborted */
  async function worker() {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++];
      try {
        results.push(await task(item));
      } catch {
        failed++;
      }
      onProgress?.(++done, items.length);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return { results, failed };
}

/**
 * Merge result lists by message id (ULIDs sort by creation time).
 * Duplicate ids are dropped.
 * @param lists Result lists, one per channel
 * @param sort Latest (newest first) or Oldest (oldest first)
 * @param limit Maximum number of items to keep
 * @returns Sorted, cut off list and whether anything was cut off
 */
export function mergeById<T extends { id: string }>(
  lists: T[][],
  sort: "Latest" | "Oldest",
  limit: number,
): { items: T[]; truncated: boolean } {
  const seen = new Set<string>();
  const all: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        all.push(item);
      }
    }
  }

  all.sort((a, b) =>
    a.id === b.id ? 0 : (a.id < b.id ? -1 : 1) * (sort === "Latest" ? -1 : 1),
  );

  return { items: all.slice(0, limit), truncated: all.length > limit };
}
