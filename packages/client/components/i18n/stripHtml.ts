/**
 * Reduce an HTML (or plain text) string to its visible text, without
 * running or fetching anything. DOMParser builds an inert document, so
 * payloads like `<img onerror=...>` never execute (unlike innerHTML on a
 * live element). Drops <head> and `[role=contentinfo]` (server error pages).
 * Needs DOMParser, so it runs in a browser or jsdom.
 *
 * @param input Plain text or HTML.
 * @returns The trimmed visible text.
 */
export function stripHtml(input: string): string {
  const doc = new DOMParser().parseFromString(input, "text/html");
  doc.head.remove();
  doc.querySelector("[role=contentinfo]")?.remove();
  return (doc.documentElement.textContent ?? "").trim();
}
