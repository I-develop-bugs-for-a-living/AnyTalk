import { describe, expect, it } from "vitest";

import {
  collectFriendsInCalls,
  collectOnlineFriends,
  groupByKey,
  pickRecentCalls,
} from "./friendsOverview";

const friends = [
  { id: "1", displayName: "Zed", online: true },
  { id: "2", displayName: "Amy", online: true },
  { id: "3", displayName: "Bob", online: false },
  { id: "4", displayName: "Cy", online: true },
];

describe("collectFriendsInCalls", () => {
  it("lists online friends in calls by name with the other people counted", () => {
    const result = collectFriendsInCalls(friends, [
      { channelId: "c1", userIds: ["1", "2", "9"] },
      { channelId: "c2", userIds: ["3"] },
    ]);
    expect(
      result.map((r) => [r.friend.id, r.call.channelId, r.others]),
    ).toEqual([
      ["2", "c1", 2],
      ["1", "c1", 2],
    ]);
  });

  it("uses the first call a friend is found in", () => {
    const result = collectFriendsInCalls(friends, [
      { channelId: "c1", userIds: ["1"] },
      { channelId: "c2", userIds: ["1", "2"] },
    ]);
    expect(result.find((r) => r.friend.id === "1")?.call.channelId).toBe("c1");
  });

  it("is empty when nobody is in a call", () => {
    expect(collectFriendsInCalls(friends, [])).toEqual([]);
  });
});

describe("pickRecentCalls", () => {
  it("skips hidden and missing channels and keeps the order", () => {
    const visible = new Set(["a", "b", "c", "d"]);
    expect(
      pickRecentCalls(
        ["a", "x", "b", "c", "d"],
        (id) => visible.has(id),
        new Set(["b"]),
        2,
      ),
    ).toEqual(["a", "c"]);
  });
});

describe("collectOnlineFriends", () => {
  it("leaves out offline friends and friends in a call, sorted by name", () => {
    expect(
      collectOnlineFriends(friends, new Set(["2"])).map((f) => f.id),
    ).toEqual(["4", "1"]);
  });
});

describe("groupByKey", () => {
  it("orders groups by their first item and keeps item order", () => {
    const groups = groupByKey(
      [
        { id: 1, s: "b" },
        { id: 2, s: "a" },
        { id: 3, s: "b" },
      ],
      (item) => item.s,
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["b", [1, 3]],
      ["a", [2]],
    ]);
  });

  it("is empty for no items", () => {
    expect(groupByKey([], () => "x")).toEqual([]);
  });
});
