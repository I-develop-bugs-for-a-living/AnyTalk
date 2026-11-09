import { GIF_PROVIDER_DOMAINS } from "../common/lib/gifs";

import type { TrafficEntry } from "./types";

/**
 * The services AnyTalk talks to. `other` is everything that matches none of
 * the configured addresses (links, avatars from other sites, updates, ...).
 */
export type ServiceId =
  | "api"
  | "events"
  | "uploads"
  | "embeds"
  | "gif"
  | "call-signalling"
  | "call-media"
  | "other";

/** All services in the order the filter lists them. */
export const SERVICES: ServiceId[] = [
  "api",
  "events",
  "uploads",
  "embeds",
  "gif",
  "call-signalling",
  "call-media",
  "other",
];

/**
 * The addresses the client is configured with, as read from the API config.
 * Every field is optional: whatever is missing is simply not matched.
 */
export type ServiceUrls = {
  /** REST API (Delta) */
  api?: string;
  /** Events WebSocket (Bonfire) */
  events?: string;
  /** File server (Autumn) */
  uploads?: string;
  /** Embed proxy (January) */
  embeds?: string;
  /** GIF provider(s) the GIF picker talks to */
  gif?: string | string[];
  /** LiveKit server(s) of a call (normally added with `addSignallingUrl`) */
  signalling?: string | string[];
};

/** A configured address split for matching: host plus path prefix. */
type Target = { host: string; prefix: string };

/** The configured addresses, parsed. */
type Targets = Partial<Record<Exclude<ServiceId, "other">, Target[]>>;

/**
 * Matches the path of LiveKit's signalling socket (`/rtc`, `/rtc/v1`,
 * `/rtc/validate`), also behind a prefix such as `/livekit/rtc`.
 */
const SIGNAL_PATH = /(^|\/)rtc(\/v\d+)?(\/|$)/;

/**
 * What `setServiceUrls` last stored. Entries are classified when they are
 * viewed, not when recorded, so changing this (an instance switch) re-labels
 * old entries too.
 */
let current: Targets = {};

/** LiveKit servers of joined calls, kept across `setServiceUrls`. */
let signalling: Target[] = [];

/**
 * Split an address into host (with port) and path prefix without a trailing
 * slash. Relative addresses are resolved against the page. Returns nothing
 * when it cannot be parsed.
 *
 * @param url Absolute or relative address
 */
function toTarget(url: string): Target | undefined {
  try {
    const parsed = new URL(url, globalThis.location?.href);
    return { host: parsed.host, prefix: parsed.pathname.replace(/\/+$/, "") };
  } catch {
    return undefined;
  }
}

/**
 * Parse a list of addresses, dropping the ones that are empty or invalid.
 *
 * @param urls One address or a list
 */
function toTargets(urls: string | string[] | undefined): Target[] {
  return (Array.isArray(urls) ? urls : [urls])
    .map((u) => (u ? toTarget(u) : undefined))
    .filter((t): t is Target => !!t);
}

/**
 * Parse the configured addresses into the form the classifier matches with.
 *
 * @param urls Addresses from the client configuration
 */
export function parseServiceUrls(urls: ServiceUrls): Targets {
  return {
    api: toTargets(urls.api),
    events: toTargets(urls.events),
    uploads: toTargets(urls.uploads),
    embeds: toTargets(urls.embeds),
    gif: toTargets(urls.gif),
  };
}

/**
 * Tell the inspector which addresses the client uses, so entries can be
 * labelled per service. Call when the client configuration is known.
 *
 * @param urls Addresses from the client configuration
 */
export function setServiceUrls(urls: ServiceUrls) {
  current = parseServiceUrls(urls);
}

/**
 * Register the LiveKit server a call joined, so its traffic counts as call
 * signalling whatever its path, even when its host is also the API's.
 *
 * @param url Address the room was joined with
 */
export function addSignallingUrl(url: string) {
  const target = toTarget(url);
  if (
    target &&
    !signalling.some(
      (t) => t.host === target.host && t.prefix === target.prefix,
    )
  ) {
    signalling = [...signalling, target];
  }
}

/**
 * Length of the best match of an address against the targets of one
 * service, or -1 when none matches. A longer path prefix is a better match,
 * so an API at `/api` and an events socket at `/events` on one host stay
 * apart.
 *
 * @param targets Parsed addresses of the service
 * @param host Host (with port) of the entry
 * @param path Path of the entry
 */
function matchLength(
  targets: Target[] | undefined,
  host: string,
  path: string,
): number {
  let best = -1;
  for (const t of targets ?? []) {
    if (t.host !== host) continue;
    if (t.prefix && path !== t.prefix && !path.startsWith(`${t.prefix}/`))
      continue;
    best = Math.max(best, t.prefix.length);
  }
  return best;
}

/**
 * Which service a URL belongs to, by the configured addresses only.
 * `websocket` entries never match the REST API and plain requests never
 * match the events socket, which matters when both share a host and path.
 *
 * @param url Address of the request
 * @param websocket Whether it is a WebSocket
 * @param targets Parsed addresses
 */
function classifyUrl(
  url: string,
  websocket: boolean,
  targets: Targets,
  joined: Target[] = signalling,
): ServiceId {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(url, globalThis.location?.href);
    host = parsed.host;
    path = parsed.pathname;
  } catch {
    return "other";
  }
  // LiveKit's signalling socket (and its /rtc/validate probe) first: the
  // media server often shares a host with nothing else
  if (SIGNAL_PATH.test(path)) return "call-signalling";

  const order: Exclude<ServiceId, "other">[] = websocket
    ? ["events", "uploads", "embeds", "gif"]
    : ["api", "uploads", "embeds", "gif"];
  let best: ServiceId = "other";
  let bestLength = -1;
  for (const id of order) {
    const length = matchLength(targets[id], host, path);
    if (length > bestLength) {
      best = id;
      bestLength = length;
    }
  }
  // GIF embeds load straight from the providers' CDNs (not configured)
  // the joined LiveKit server wins ties with a service on the same host
  const joinedLength = matchLength(joined, host, path);
  if (joinedLength >= 0 && joinedLength >= bestLength) {
    return "call-signalling";
  }
  if (best === "other" && isGifProviderHost(host)) return "gif";
  return best;
}

/**
 * Whether a host is a GIF provider or one of its subdomains (media CDNs).
 *
 * @param host Host, with an optional port
 */
function isGifProviderHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return GIF_PROVIDER_DOMAINS.some((d) => name === d || name.endsWith(`.${d}`));
}

/**
 * Tag an entry with the service it talks to. The configured addresses come
 * from `setServiceUrls`. Call entries are classified by kind: the join, data
 * messages and attributes travel over the signalling connection, the
 * selected network path and byte counts are the media.
 *
 * @param entry Any entry
 * @param urls Addresses to use instead of the stored ones (tests)
 */
export function classifyService(
  entry: TrafficEntry,
  urls?: ServiceUrls,
): ServiceId {
  switch (entry.kind) {
    case "call-info":
    case "call-data":
    case "call-attribute":
      return "call-signalling";
    case "call-connection":
    case "call-bytes":
      return "call-media";
    case "ws":
      return classifyUrl(
        entry.url,
        true,
        urls ? parseServiceUrls(urls) : current,
        urls ? toTargets(urls.signalling) : signalling,
      );
    default:
      return classifyUrl(
        entry.url,
        false,
        urls ? parseServiceUrls(urls) : current,
        urls ? toTargets(urls.signalling) : signalling,
      );
  }
}
