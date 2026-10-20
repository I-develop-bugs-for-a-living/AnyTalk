import { describe, expect, test } from "vitest";

import { mergeById, runLimited } from "./serverSearch";

describe("mergeById", () => {
  const lists = [
    [{ id: "01B" }, { id: "01D" }],
    [{ id: "01A" }, { id: "01D" }, { id: "01C" }],
  ];

  test("sorts newest first and drops duplicates", () => {
    expect(mergeById(lists, "Latest", 10).items.map((i) => i.id)).toEqual([
      "01D",
      "01C",
      "01B",
      "01A",
    ]);
  });

  test("sorts oldest first", () => {
    expect(mergeById(lists, "Oldest", 10).items.map((i) => i.id)).toEqual([
      "01A",
      "01B",
      "01C",
      "01D",
    ]);
  });

  test("cuts off and reports truncation", () => {
    const result = mergeById(lists, "Latest", 2);
    expect(result.items.map((i) => i.id)).toEqual(["01D", "01C"]);
    expect(result.truncated).toBe(true);
    expect(mergeById(lists, "Latest", 4).truncated).toBe(false);
  });
});

describe("mergeById edge cases", () => {
  test("keeps everything when the limit is larger than the list", () => {
    const result = mergeById([[{ id: "01A" }]], "Latest", 50);
    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  test("duplicates alone never count as truncation", () => {
    const result = mergeById([[{ id: "01A" }], [{ id: "01A" }]], "Latest", 1);
    expect(result.truncated).toBe(false);
  });
});

describe("runLimited", () => {
  test("respects the concurrency limit and counts failures", async () => {
    let active = 0;
    let peak = 0;
    const progress: number[] = [];
    const { results, failed } = await runLimited(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (n === 4) throw new Error("403");
        return n;
      },
      (done) => progress.push(done),
    );
    expect(peak).toBe(3);
    expect(results.sort()).toEqual([1, 2, 3, 5, 6, 7]);
    expect(failed).toBe(1);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("reports every task as failed when all reject", async () => {
    const { results, failed } = await runLimited([1, 2], 6, async () => {
      throw new Error("403");
    });
    expect(results).toEqual([]);
    expect(failed).toBe(2);
  });

  test("works when the limit is larger than the item count", async () => {
    const { results } = await runLimited([1, 2], 6, async (n) => n * 2);
    expect(results.sort()).toEqual([2, 4]);
  });

  test("stops picking up new items once aborted", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await runLimited(
      [1, 2, 3, 4, 5],
      1,
      async (n) => {
        started.push(n);
        if (n === 2) controller.abort();
      },
      undefined,
      controller.signal,
    );
    expect(started).toEqual([1, 2]);
  });

  test("handles an empty list", async () => {
    expect(await runLimited([], 6, async () => 1)).toEqual({
      results: [],
      failed: 0,
    });
  });
});
