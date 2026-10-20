import { describe, expect, it } from "vitest";

import {
  type OverviewEntry,
  type OverviewServer,
  filterServers,
  groupByFolder,
  sortServers,
} from "./serverOverview";

/** Make a server with sensible defaults */
const s = (
  id: string,
  extra: Partial<OverviewServer> = {},
): OverviewServer => ({
  id,
  name: id,
  unread: false,
  mentions: 0,
  muted: false,
  ...extra,
});

const ids = (list: OverviewServer[]) => list.map((x) => x.id);

describe("filterServers", () => {
  const list = [
    s("a", { name: "Café Club", description: "Coffee talk" }),
    s("b", { name: "Games", description: null }),
  ];

  it("keeps everything for an empty query", () => {
    expect(filterServers(list, "  ")).toHaveLength(2);
  });

  it("ignores case and accents in name and description", () => {
    expect(ids(filterServers(list, "CAFE"))).toEqual(["a"]);
    expect(ids(filterServers(list, "coffee"))).toEqual(["a"]);
    expect(ids(filterServers(list, "games"))).toEqual(["b"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterServers(list, "zzz")).toEqual([]);
  });
});

describe("sortServers", () => {
  const list = [
    s("c", { name: "Charlie", joinedAt: 20 }),
    s("a", { name: "alpha", joinedAt: 30 }),
    s("b", { name: "Bravo" }),
  ];

  it("keeps the rail order", () => {
    expect(ids(sortServers(list, "rail"))).toEqual(["c", "a", "b"]);
  });

  it("sorts by name", () => {
    expect(ids(sortServers(list, "name", "en"))).toEqual(["a", "b", "c"]);
  });

  it("sorts recently joined first, unknown dates last", () => {
    expect(ids(sortServers(list, "recent"))).toEqual(["a", "c", "b"]);
  });

  it("sorts oldest joined first, unknown dates last", () => {
    expect(ids(sortServers(list, "oldest"))).toEqual(["c", "a", "b"]);
  });

  it("puts mentions, then unread first and ignores muted plain unread but keeps muted mentions", () => {
    const unread = [
      s("1"),
      s("2", { unread: true }),
      s("3", { mentions: 2 }),
      s("4", { unread: true, muted: true }),
      s("6", { mentions: 1, muted: true }),
      s("5", { unread: true }),
    ];
    expect(ids(sortServers(unread, "unread"))).toEqual([
      "3",
      "6",
      "2",
      "5",
      "1",
      "4",
    ]);
  });

  it("does not change the input", () => {
    sortServers(list, "name");
    expect(ids(list)).toEqual(["c", "a", "b"]);
  });
});

describe("groupByFolder", () => {
  const entries: OverviewEntry<OverviewServer>[] = [
    { type: "server", server: s("a") },
    { type: "server", server: s("b") },
    {
      type: "folder",
      folder: {
        id: "f1",
        name: "Friends",
        colour: "red",
        servers: [s("c"), s("d")],
      },
    },
    { type: "server", server: s("e") },
    { type: "folder", folder: { id: "f2", name: "Empty", servers: [] } },
  ];

  it("makes a section per folder and per run of loose servers", () => {
    const sections = groupByFolder(entries);
    expect(sections.map((x) => [x.folder?.name, ids(x.servers)])).toEqual([
      [undefined, ["a", "b"]],
      ["Friends", ["c", "d"]],
      [undefined, ["e"]],
    ]);
    expect(sections[1].folder?.colour).toBe("red");
  });

  it("drops hidden servers and folders left empty", () => {
    const sections = groupByFolder(
      entries,
      (x) => x.id !== "c" && x.id !== "d",
    );
    expect(sections.map((x) => ids(x.servers))).toEqual([["a", "b", "e"]]);
  });
});
