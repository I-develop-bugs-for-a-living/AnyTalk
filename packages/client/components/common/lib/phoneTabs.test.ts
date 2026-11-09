import { describe, expect, it } from "vitest";

import {
  countIncomingRequests,
  countUnreadConversations,
  formatBadgeCount,
  isHomeRoute,
  isPhoneTab,
  summarizeServers,
  tabForRoute,
} from "./phoneTabs";

describe("isPhoneTab", () => {
  it("accepts tab names only", () => {
    expect(isPhoneTab("inbox")).toBe(true);
    expect(isPhoneTab("friends")).toBe(false);
    expect(isPhoneTab(undefined)).toBe(false);
  });
});

describe("countIncomingRequests", () => {
  it("counts only incoming requests", () => {
    expect(
      countIncomingRequests([
        { relationship: "Incoming" },
        { relationship: "Friend" },
        { relationship: "Outgoing" },
        { relationship: "Incoming" },
      ]),
    ).toBe(2);
    expect(countIncomingRequests([])).toBe(0);
  });
});

describe("countUnreadConversations", () => {
  it("ignores read and muted conversations", () => {
    expect(
      countUnreadConversations([
        { unread: true, muted: false },
        { unread: true, muted: true },
        { unread: false, muted: false },
        { unread: true, muted: false },
      ]),
    ).toBe(2);
  });
});

describe("summarizeServers", () => {
  it("sums mentions and hides the dot when there are mentions", () => {
    expect(
      summarizeServers([
        { unread: true, muted: false, mentions: 2 },
        { unread: true, muted: false, mentions: 1 },
      ]),
    ).toEqual({ mentions: 3, dot: false });
  });

  it("shows a dot for unreads without mentions", () => {
    expect(
      summarizeServers([{ unread: true, muted: false, mentions: 0 }]),
    ).toEqual({ mentions: 0, dot: true });
  });

  it("skips muted servers", () => {
    expect(
      summarizeServers([{ unread: true, muted: true, mentions: 5 }]),
    ).toEqual({ mentions: 0, dot: false });
  });
});

describe("formatBadgeCount", () => {
  it("caps large numbers", () => {
    expect(formatBadgeCount(7)).toBe("7");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
  });
});

describe("tabForRoute", () => {
  it("maps the home page", () => {
    expect(tabForRoute({ path: "/app" })).toBe("home");
  });

  it("maps server routes", () => {
    expect(tabForRoute({ path: "/server/X", serverId: "X" })).toBe("servers");
  });

  it("maps conversations to messages", () => {
    for (const channelType of ["DirectMessage", "Group", "SavedMessages"]) {
      expect(
        tabForRoute({ path: "/channel/C", channelId: "C", channelType }),
      ).toBe("messages");
    }
  });

  it("maps server channels without a server in the path", () => {
    expect(
      tabForRoute({
        path: "/channel/C",
        channelId: "C",
        channelType: "TextChannel",
      }),
    ).toBe("servers");
  });

  it("keeps the tab for shared pages and unknown channels", () => {
    expect(tabForRoute({ path: "/friends" })).toBeUndefined();
    expect(tabForRoute({ path: "/servers" })).toBeUndefined();
    expect(tabForRoute({ path: "/channel/C", channelId: "C" })).toBeUndefined();
  });
});

describe("isHomeRoute", () => {
  it("matches only /app", () => {
    expect(isHomeRoute("/app")).toBe(true);
    expect(isHomeRoute("/friends")).toBe(false);
  });
});
