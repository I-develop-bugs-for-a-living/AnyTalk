import type { BodySummary, HeaderList } from "./types";

/** Longest text kept for a body or frame preview, in characters. */
export const PREVIEW_LIMIT = 4096;

/** Longest text kept for a WebSocket frame preview, in characters. */
export const FRAME_PREVIEW_LIMIT = 2048;

/** Strings longer than this get an estimated size instead of a UTF-8 copy. */
const EXACT_SIZE_MAX_CHARS = 1_000_000;

/** Number of leading bytes shown as hex for binary frames. */
export const HEX_BYTES = 32;

/** Largest response body (bytes) that is read for a preview. */
export const RESPONSE_PREVIEW_MAX_BYTES = 64 * 1024;

/**
 * UTF-8 byte length of a string (character count for very large strings).
 */
export function utf8Length(text: string): number {
  // estimate (character count) for huge strings, to avoid copying them
  if (text.length > EXACT_SIZE_MAX_CHARS) return text.length;
  return new TextEncoder().encode(text).length;
}

/**
 * Cut a string at `limit` characters.
 */
export function truncateText(
  text: string,
  limit = PREVIEW_LIMIT,
): { text: string; truncated: boolean } {
  return text.length > limit
    ? { text: text.slice(0, limit), truncated: true }
    : { text, truncated: false };
}

/**
 * Describe a request body without reading it asynchronously.
 *
 * Strings and URL-encoded params are kept as text (cut at the limit), FormData
 * as field names plus file names, sizes and types, Blob/ArrayBuffer as size and
 * type, streams as "stream".
 */
export function summarizeBody(body: unknown): BodySummary {
  if (body === null || body === undefined) return { kind: "none" };

  if (typeof body === "string") {
    return { kind: "text", size: utf8Length(body), ...truncateText(body) };
  }

  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    const text = body.toString();
    return { kind: "text", size: utf8Length(text), ...truncateText(text) };
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const fields: {
      name: string;
      file?: { name: string; size: number; type: string };
    }[] = [];
    body.forEach((value, name) => {
      if (typeof value === "string") {
        fields.push({ name });
      } else {
        fields.push({
          name,
          file: { name: value.name, size: value.size, type: value.type },
        });
      }
    });
    return { kind: "form", fields };
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { kind: "binary", size: body.size, type: body.type || undefined };
  }

  if (body instanceof ArrayBuffer) {
    return { kind: "binary", size: body.byteLength };
  }

  if (ArrayBuffer.isView(body)) {
    return { kind: "binary", size: body.byteLength };
  }

  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { kind: "stream" };
  }

  return { kind: "other", description: Object.prototype.toString.call(body) };
}

/**
 * Hex string of the first bytes of binary data, separated by spaces.
 *
 * @param data ArrayBuffer or a view over one
 * @param count Number of bytes to show
 */
export function hexPreview(
  data: ArrayBuffer | ArrayBufferView,
  count = HEX_BYTES,
): { hex: string; truncated: boolean; size: number } {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const parts: string[] = [];
  for (let i = 0; i < Math.min(count, bytes.length); i++) {
    parts.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return {
    hex: parts.join(" "),
    truncated: bytes.length > count,
    size: bytes.length,
  };
}

/**
 * Host (with port) of a URL, or an empty string when it cannot be parsed.
 *
 * @param url Absolute or relative URL
 * @param base Base for relative URLs
 */
export function hostOf(url: string, base?: string): string {
  try {
    return new URL(url, base).host;
  } catch {
    return "";
  }
}

/**
 * Turn a `Headers`, array or plain object into a header list.
 */
export function headersToList(
  headers: HeadersInit | undefined | null,
): HeaderList {
  if (!headers) return [];
  const out: HeaderList = [];
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, name) => out.push([name, value]));
  } else if (Array.isArray(headers)) {
    for (const [name, value] of headers) out.push([name, String(value)]);
  } else {
    for (const [name, value] of Object.entries(headers)) {
      out.push([name, String(value)]);
    }
  }
  return out;
}

/**
 * Parse the text of `XMLHttpRequest.getAllResponseHeaders()`.
 */
export function parseRawHeaders(raw: string): HeaderList {
  const out: HeaderList = [];
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index > 0) {
      out.push([line.slice(0, index).trim(), line.slice(index + 1).trim()]);
    }
  }
  return out;
}

/**
 * Whether a content type is text or JSON, so a preview makes sense.
 */
export function isTextContentType(contentType: string | null | undefined) {
  if (!contentType) return false;
  return /^(text\/|application\/(json|[\w.+-]*\+json|xml|javascript))/i.test(
    contentType.trim(),
  );
}

/**
 * Find a header value by name, case-insensitive.
 */
export function findHeader(
  headers: HeaderList,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([n]) => n.toLowerCase() === lower)?.[1];
}
