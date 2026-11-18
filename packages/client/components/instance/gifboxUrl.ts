/**
 * Whether a hostname is gifbox.me or one of its subdomains. The public Gifbox
 * must never receive a session token.
 *
 * @param hostname Hostname to check
 */
function isPublicGifboxHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "gifbox.me" || host.endsWith(".gifbox.me");
}

/**
 * Whether a hostname is local or on a private network (dev setups), where
 * plain http is acceptable.
 *
 * @param hostname Hostname as given by `URL.hostname`
 */
function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]" || host === "::1") return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

/**
 * Parse a candidate URL and check the protocol: https, or http for local and
 * private-network hosts only.
 *
 * @param value URL string
 * @returns The parsed URL, or undefined if invalid or insecure
 */
function parseSecure(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && isLocalHost(url.hostname)) return url;
  } catch {
    // invalid
  }
  return undefined;
}

/**
 * Remove trailing slashes.
 *
 * @param value URL string
 */
export function trimSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

/**
 * Derive the Gifbox URL from the instance itself. The stock self-hosted
 * Caddyfile serves Gifbox at `/gifbox` next to `/january` and `/autumn`.
 * A january or autumn URL ending in one of those is used only if it has the
 * same origin as the API (autumn is often on a separate CDN host, which must
 * not get the token). Otherwise the API's own base path is used with its
 * last segment replaced (`https://host/api` becomes `https://host/gifbox`).
 *
 * @param serviceUrls January and autumn URLs from the API root config
 * @param apiUrl API URL of the instance
 * @returns Derived Gifbox URL, or undefined if nothing usable
 */
export function deriveGifboxUrl(
  serviceUrls: (string | undefined)[],
  apiUrl?: string,
) {
  let api: URL;
  try {
    api = new URL(apiUrl ?? "");
  } catch {
    return undefined;
  }
  if (api.protocol !== "https:" && api.protocol !== "http:") return undefined;

  for (const candidate of serviceUrls) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      const path = trimSlashes(url.pathname);
      if (url.origin === api.origin && /\/(january|autumn)$/.test(path))
        return `${url.origin}${path.replace(/\/(january|autumn)$/, "")}/gifbox`;
    } catch {
      // invalid, try the next one
    }
  }

  const base = trimSlashes(api.pathname).replace(/\/[^/]*$/, "");
  return `${api.origin}${base}/gifbox`;
}

/**
 * Whether two hostnames belong together: the same host, or the candidate is
 * the API host's parent domain or a subdomain of it. There is no public
 * suffix list here, so the parent is only used when the API host has at
 * least three labels (`api.example.com` allows `gifbox.example.com`). A host
 * with fewer labels only allows itself and its own subdomains.
 *
 * @param candidate Hostname of the advertised Gifbox
 * @param apiHost Hostname of the API
 */
export function isRelatedHost(candidate: string, apiHost: string) {
  const host = candidate.toLowerCase();
  const api = apiHost.toLowerCase();
  const labels = api.split(".");
  const base = labels.length >= 3 ? labels.slice(1).join(".") : api;
  return host === base || host.endsWith(`.${base}`);
}

/**
 * Pick the Gifbox URL for an instance, in order: the one the API advertises
 * (must be related to the API host), the env override (a deliberate dev
 * setting, may point anywhere), then one derived from the instance itself.
 * gifbox.me is always rejected and plain http is only allowed for local and
 * private hosts, since the session token is sent to this URL.
 *
 * @param advertised Gifbox URL from the API root config
 * @param override Gifbox URL from the environment (default instance only)
 * @param derived Gifbox URL derived from the instance (see `deriveGifboxUrl`)
 * @param apiUrl API URL of the instance, to relate the advertised URL to
 */
export function resolveGifboxUrl(
  advertised?: string,
  override?: string,
  derived?: string,
  apiUrl?: string,
) {
  let apiHost: string | undefined;
  try {
    apiHost = new URL(apiUrl ?? "").hostname;
  } catch {
    // no API URL, advertised values can't be related and are skipped
  }

  const candidates: (string | undefined)[] = [
    advertised &&
    apiHost &&
    isRelatedHost(parseSecure(advertised)?.hostname ?? "", apiHost)
      ? advertised
      : undefined,
    override,
    derived,
  ];

  for (const candidate of candidates) {
    const url = parseSecure(candidate);
    if (url && !isPublicGifboxHost(url.hostname))
      return trimSlashes(candidate!);
  }
  return undefined;
}
