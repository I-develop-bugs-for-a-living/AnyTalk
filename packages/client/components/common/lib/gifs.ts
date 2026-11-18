import type { MessageEmbed, WebsiteEmbed } from "stoat.js";

/**
 * Full origins of gif providers allowed to embed.
 */
export const GIF_PROVIDERS = [
  "https://tenor.com",
  "https://giphy.com",
  "https://gifbox.me",
];

/**
 * Domains of the GIF providers (from `GIF_PROVIDERS`). Their media CDNs are
 * subdomains of these (media.tenor.com, media1.giphy.com, i.giphy.com), so
 * match by suffix.
 */
export const GIF_PROVIDER_DOMAINS = GIF_PROVIDERS.map(
  (origin) => new URL(origin).hostname,
);

/**
 * Whether a hostname is a GIF provider or one of its subdomains. Compares whole
 * labels, so `tenor.com.evil.example` and `eviltenor.com` don't match.
 *
 * @param hostname Hostname to check
 * @returns Whether the hostname belongs to a GIF provider
 */
export function isGifProviderHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return GIF_PROVIDER_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Whether a media URL is served by a GIF provider. Only these may be loaded
 * without the image proxy; anything else would leak the viewer's IP address.
 *
 * @param url Media URL of an embed
 * @returns Whether the URL's own host is a GIF provider (https only)
 */
export function isGifProviderUrl(url?: string) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && isGifProviderHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a URL is hosted by gifbox.me or one of its subdomains.
 *
 * @param url URL to check
 */
export function isGifBoxUrl(url?: string) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host === "gifbox.me" || host.endsWith(".gifbox.me");
  } catch {
    return false;
  }
}

/**
 * Pick the URL an embed was made from.
 *
 * @param embed Embed to read
 */
function embedSourceUrl(embed: MessageEmbed) {
  if (embed.type === "Website") {
    const webEmbed = embed as WebsiteEmbed;
    return webEmbed.originalUrl || webEmbed.url || undefined;
  }
  if (embed.type === "Image" || embed.type === "Video") {
    return (embed as { url?: string }).url || undefined;
  }
  return undefined;
}

/**
 * Check the giffyness of an embed. Never throws on malformed URLs.
 *
 * @param embed MessageEmbed to check for giffyness
 * @returns Whether embed is a gif
 */
export function isGif(embed: MessageEmbed) {
  return isGifProviderUrl(embedSourceUrl(embed));
}

/**
 * Whether an embed comes from gifbox.me. Never throws on malformed URLs.
 *
 * @param embed MessageEmbed to check
 */
export function isGifBox(embed: MessageEmbed) {
  return isGifBoxUrl(embedSourceUrl(embed));
}
