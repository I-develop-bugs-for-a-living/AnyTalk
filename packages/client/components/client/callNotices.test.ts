import { describe, expect, it } from "vitest";

import {
  isHiddenCallNotice,
  liveAckTarget,
  startupAckTarget,
} from "./callNotices";

const call = (id: string) => ({ id, systemMessage: { type: "call_started" } });
const text = (id: string) => ({ id });

describe("isHiddenCallNotice", () => {
  it("only matches call_started", () => {
    expect(isHiddenCallNotice(call("a"))).toBe(true);
    expect(isHiddenCallNotice({})).toBe(false);
    expect(isHiddenCallNotice({ systemMessage: { type: "user_joined" } })).toBe(
      false,
    );
  });
});

describe("liveAckTarget", () => {
  it("acks a notice in a fully read channel", () => {
    expect(liveAckTarget("b", "b", call("c"))).toBe("c");
    expect(liveAckTarget("z", "b", call("c"))).toBe("c");
  });

  it("acks in an empty channel", () => {
    expect(liveAckTarget(undefined, undefined, call("c"))).toBe("c");
  });

  it("never acks over real unread messages", () => {
    expect(liveAckTarget("a", "b", call("c"))).toBeUndefined();
    expect(liveAckTarget(undefined, "b", call("c"))).toBeUndefined();
  });

  it("ignores other messages and unknown history", () => {
    expect(liveAckTarget("b", "b", text("c"))).toBeUndefined();
    expect(liveAckTarget("b", "c", call("c"))).toBeUndefined();
  });
});

describe("startupAckTarget", () => {
  it("acks the newest of only call notices", () => {
    expect(startupAckTarget([call("a"), call("b"), call("c")], 15)).toBe("c");
  });

  it("leaves anything else", () => {
    expect(startupAckTarget([], 15)).toBeUndefined();
    expect(startupAckTarget([call("a"), text("b")], 15)).toBeUndefined();
    expect(startupAckTarget([call("a"), call("b")], 2)).toBeUndefined();
  });
});
