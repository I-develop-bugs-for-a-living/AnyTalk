/**
 * Sort modes of the server overview
 */
export type ServerSort = "rail" | "name" | "recent" | "oldest" | "unread";

/**
 * The part of a server the overview needs for sorting and filtering
 */
export interface OverviewServer {
  id: string;
  name: string;
  description?: string | null;
  /** When the user joined, as a timestamp, if known */
  joinedAt?: number;
  /** Whether the server has unread messages */
  unread: boolean;
  /** Number of unread mentions */
  mentions: number;
  /** Whether the server is muted */
  muted: boolean;
}

/**
 * A folder of the server rail with its servers
 */
export interface OverviewFolder<T> {
  id: string;
  name: string;
  colour?: string;
  servers: T[];
}

/**
 * One entry of the server rail: a lone server or a folder
 */
export type OverviewEntry<T> =
  | { type: "server"; server: T }
  | { type: "folder"; folder: OverviewFolder<T> };

/**
 * A heading with its servers; the heading is missing for servers outside
 * of folders
 */
export interface OverviewSection<T> {
  key: string;
  folder?: { id: string; name: string; colour?: string };
  servers: T[];
}

/**
 * Normalise text for searching: lower case, without accents
 */
export function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

/**
 * Keep the servers whose name or description contain the query, ignoring
 * case and accents. An empty query keeps everything.
 */
export function filterServers<T extends OverviewServer>(
  servers: T[],
  query: string,
): T[] {
  const needle = normalise(query.trim());
  if (!needle) return servers;

  return servers.filter(
    (server) =>
      normalise(server.name).includes(needle) ||
      normalise(server.description ?? "").includes(needle),
  );
}

/**
 * Unread rank of a server: 2 for mentions, 1 for unread, 0 otherwise.
 * Like the rail, mentions count even when muted; plain unread does not.
 */
function unreadRank(server: OverviewServer): number {
  if (server.mentions > 0) return 2;
  return server.unread && !server.muted ? 1 : 0;
}

/**
 * Sort servers. `servers` must be in rail order, which is the starting
 * point and the tie breaker (the sort is stable).
 */
export function sortServers<T extends OverviewServer>(
  servers: T[],
  sort: ServerSort,
  locale?: string,
): T[] {
  const list = [...servers];

  switch (sort) {
    case "name":
      return list.sort((a, b) => a.name.localeCompare(b.name, locale));
    case "recent":
      // servers with an unknown date go last; -Infinity - -Infinity is NaN,
      // which sorts as equal, so unknown dates keep their rail order
      return list.sort(
        (a, b) => (b.joinedAt ?? -Infinity) - (a.joinedAt ?? -Infinity),
      );
    case "oldest":
      return list.sort(
        (a, b) => (a.joinedAt ?? Infinity) - (b.joinedAt ?? Infinity),
      );
    case "unread":
      return list.sort((a, b) => unreadRank(b) - unreadRank(a));
    default:
      return list;
  }
}

/**
 * Group the rail entries into sections: a section per folder and one
 * section for each run of servers outside of folders, in rail order.
 * Servers not matching `visible` are dropped, and folders left without
 * servers disappear.
 */
export function groupByFolder<T extends OverviewServer>(
  entries: OverviewEntry<T>[],
  visible: (server: T) => boolean = () => true,
): OverviewSection<T>[] {
  const sections: OverviewSection<T>[] = [];

  for (const entry of entries) {
    if (entry.type === "folder") {
      const servers = entry.folder.servers.filter(visible);
      if (servers.length) {
        sections.push({
          key: entry.folder.id,
          folder: {
            id: entry.folder.id,
            name: entry.folder.name,
            colour: entry.folder.colour,
          },
          servers,
        });
      }
    } else if (visible(entry.server)) {
      const last = sections[sections.length - 1];
      if (last && !last.folder) {
        last.servers.push(entry.server);
      } else {
        sections.push({
          key: `loose-${entry.server.id}`,
          servers: [entry.server],
        });
      }
    }
  }

  return sections;
}
