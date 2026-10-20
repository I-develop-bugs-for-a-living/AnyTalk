import { describe, expect, test } from "vitest";

import {
  CANCELLED,
  collectMentions,
  countMentions,
  createLimiter,
  hasMentions,
  isExtraMention,
  isNotFoundError,
  isStillUnread,
  mergeMentionIds,
} from "./inboxMentions";

const channel = (id: string, mentions: string[], muted = false) => ({
  id,
  muted,
  mentions: new Set(mentions),
});

describe("collectMentions", () => {
  test("sorts newest first across channels", () => {
    const a = channel("a", ["01A", "01C"]);
    const b = channel("b", ["01B"]);
    expect(collectMentions([a, b]).map((r) => r.messageId)).toEqual([
      "01C",
      "01B",
      "01A",
    ]);
  });

  test("skips muted channels and channels without mentions", () => {
    const muted = channel("m", ["01A"], true);
    const none = { id: "n", muted: false };
    const ok = channel("o", ["01B"]);
    expect(collectMentions([muted, none, ok]).map((r) => r.channel.id)).toEqual(
      ["o"],
    );
  });

  test("caps the list", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `01${i + 10}`);
    const result = collectMentions([channel("a", ids)]);
    expect(result).toHaveLength(50);
    expect(result[0].messageId).toBe("0169");
  });
});

describe("countMentions", () => {
  test("ignores muted channels", () => {
    expect(
      countMentions([channel("a", ["1", "2"]), channel("b", ["3"], true)]),
    ).toBe(2);
  });
});

describe("createLimiter", () => {
  test("never runs more than the limit at once", async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => limit(task)));
    expect(peak).toBe(2);
  });

  test("keeps going after a task fails", async () => {
    const limit = createLimiter(1);
    const failed = limit(() => Promise.reject(new Error("x")));
    const ok = limit(async () => "ok");
    await expect(failed).rejects.toThrow("x");
    await expect(ok).resolves.toBe("ok");
  });
});

describe("isExtraMention", () => {
  const base = {
    userId: "me",
    authorId: "other",
    flags: 0,
    isConversation: false,
  };

  test("accepts any message in a DM or group", () => {
    expect(isExtraMention({ ...base, isConversation: true })).toBe(true);
  });

  test("ignores plain server messages", () => {
    expect(isExtraMention(base)).toBe(false);
  });

  test("accepts @everyone and held roles only", () => {
    expect(isExtraMention({ ...base, flags: 2 })).toBe(true);
    expect(
      isExtraMention({
        ...base,
        roleMentionIds: ["r1"],
        memberRoleIds: ["r1"],
      }),
    ).toBe(true);
    expect(
      isExtraMention({
        ...base,
        roleMentionIds: ["r1"],
        memberRoleIds: ["r2"],
      }),
    ).toBe(false);
  });

  test("ignores own and suppressed messages", () => {
    expect(
      isExtraMention({ ...base, isConversation: true, authorId: "me" }),
    ).toBe(false);
    expect(isExtraMention({ ...base, isConversation: true, flags: 1 })).toBe(
      false,
    );
  });
});

describe("isStillUnread", () => {
  test("compares with the last read id", () => {
    expect(isStillUnread("02", "01")).toBe(true);
    expect(isStillUnread("01", "01")).toBe(false);
    expect(isStillUnread("01", "02")).toBe(false);
    expect(isStillUnread("01", undefined)).toBe(true);
  });
});

describe("mergeMentionIds", () => {
  test("merges without duplicates and drops read live entries", () => {
    const merged = mergeMentionIds(["03", "05"], ["03", "04", "02"], "02");
    expect([...merged].sort()).toEqual(["03", "04", "05"]);
  });

  test("handles missing inputs", () => {
    expect(mergeMentionIds(undefined, undefined, undefined).size).toBe(0);
  });
});

describe("failed ids", () => {
  test("are left out of the list and the count", () => {
    const a = channel("a", ["01", "02", "03"]);
    const failed = new Set(["02"]);
    expect(collectMentions([a], failed).map((r) => r.messageId)).toEqual([
      "03",
      "01",
    ]);
    expect(countMentions([a], failed)).toBe(2);
  });

  test("are removed before the cap, so they do not use up slots", () => {
    const ids = Array.from({ length: 55 }, (_, i) => `01${i + 10}`);
    // the five newest are gone
    const failed = new Set(ids.slice(-5));
    const result = collectMentions([channel("a", ids)], failed);
    expect(result).toHaveLength(50);
    expect(result[0].messageId).toBe("0159");
    expect(countMentions([channel("a", ids)], failed)).toBe(50);
  });
});

describe("hasMentions", () => {
  test("is false for muted or empty channels", () => {
    expect(hasMentions(channel("a", ["1"]))).toBe(true);
    expect(hasMentions(channel("a", ["1"], true))).toBe(false);
    expect(hasMentions(channel("a", []))).toBe(false);
  });
});

describe("createLimiter cancel", () => {
  test("skips queued tasks that were cancelled", async () => {
    const limit = createLimiter(1);
    let ran = 0;
    let cancelled = false;
    const first = limit(async () => {
      ran++;
      cancelled = true;
    });
    const second = limit(
      async () => {
        ran++;
      },
      () => cancelled,
    );
    await first;
    await expect(second).rejects.toBe(CANCELLED);
    expect(ran).toBe(1);
  });
});

describe("isNotFoundError", () => {
  test("accepts the API's not found answers", () => {
    expect(isNotFoundError('{"type":"NotFound"}')).toBe(true);
    expect(isNotFoundError('{"type":"UnknownMessage"}')).toBe(true);
    expect(isNotFoundError({ type: "NotFound" })).toBe(true);
    expect(isNotFoundError({ status: 404 })).toBe(true);
  });

  test("rejects temporary and unrelated failures", () => {
    expect(isNotFoundError('{"type":"InternalError"}')).toBe(false);
    expect(isNotFoundError('{"type":"TooManyRequests"}')).toBe(false);
    expect(isNotFoundError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNotFoundError("<html>502 Bad Gateway</html>")).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});
