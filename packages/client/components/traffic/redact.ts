import type {
  BodySummary,
  CallAttributeEntry,
  CallDataEntry,
  CallInfoEntry,
  HeaderList,
  HttpEntry,
  ResourceEntry,
  TrafficEntry,
  WsEntry,
} from "./types";

/** Replacement shown instead of a secret. */
export const REDACTED = "[redacted]";

/** Header names (lower case) whose values are secret. */
const SECRET_HEADERS = new Set([
  "x-session-token",
  "x-bot-token",
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-mfa-ticket",
]);

/** Query parameter names (lower case) whose values are secret. */
const SECRET_PARAMS = new Set([
  "token",
  "access_token",
  "session_token",
  "x-session-token",
  "x-bot-token",
]);

/** Exact JSON field names (lower case) that hold secrets. */
const SECRET_FIELDS = new Set([
  "password",
  "current_password",
  "new_password",
  "token",
  "access_token",
  "session_token",
  "totp_code",
  "recovery_code",
  "mfa_ticket",
  "ticket",
  "secret",
  "captcha",
  "authorization",
  "cookie",
  "email_token",
  "reset_token",
]);

/** Auth and account routes whose whole bodies are hidden. */
const SECRET_ROUTE =
  /\/(push\/subscribe|auth\/(mfa|session\/login|account\/(create|reverify|delete|verify|reset_password|change)))/i;

/**
 * Whether a JSON field name holds a secret.
 */
export function isSecretField(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SECRET_FIELDS.has(lower) ||
    lower.endsWith("_token") ||
    lower.endsWith("_password") ||
    lower.endsWith("_secret")
  );
}

/**
 * Whether the URL belongs to an auth/MFA/account route whose bodies are hidden.
 */
export function isSecretRoute(url: string): boolean {
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    // keep the raw string
  }
  return SECRET_ROUTE.test(path);
}

/**
 * Redact secret query/fragment parameters, credentials in the URL
 * (`user:pass@`) and the code in `/auth/account/verify/<code>`. Works on the
 * raw string, so everything else stays byte-identical to what went on the wire.
 */
export function redactUrl(url: string): string {
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, "$1")
    .replace(/(\/auth\/account\/verify\/)[^/?#]+/i, `$1${REDACTED}`)
    .replace(
      /([?&#])([^=&#?]+)=([^&#]*)/g,
      (match, lead: string, key: string) => {
        let name = key;
        try {
          name = decodeURIComponent(key);
        } catch {
          // use the raw key
        }
        return SECRET_PARAMS.has(name.toLowerCase())
          ? `${lead}${key}=${REDACTED}`
          : match;
      },
    );
}

/**
 * Redact secret header values.
 */
export function redactHeaders(headers: HeaderList): HeaderList {
  return headers.map(([name, value]) => [
    name,
    SECRET_HEADERS.has(name.toLowerCase()) ? REDACTED : value,
  ]);
}

/**
 * Replace secret fields anywhere in a parsed JSON value.
 */
export function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (value && typeof value === "object") {
    // no prototype, so a "__proto__" key stays an ordinary property
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, inner] of Object.entries(value)) {
      Object.defineProperty(out, key, {
        value: isSecretField(key) ? REDACTED : redactJsonValue(inner),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

/**
 * Redact secrets in text that may be JSON. Valid JSON is parsed; text that is
 * cut off or not JSON falls back to a pattern for `"field": "value"` pairs;
 * form-encoded text gets its `field=value` pairs redacted.
 */
export function redactJsonText(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactJsonValue(JSON.parse(text)));
    } catch {
      // fall through to the pattern
    }
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    // form-encoded bodies: key=value pairs joined by &
    text = text.replace(
      /(^|&)([^=&]+)=([^&]*)/g,
      (match, lead: string, key: string) => {
        let name = key;
        try {
          name = decodeURIComponent(key.replace(/\+/g, " "));
        } catch {
          // use the raw key
        }
        return isSecretField(name) ? `${lead}${key}=${REDACTED}` : match;
      },
    );
  }
  return text.replace(
    /("([^"\\]*)"\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,}\]\s]+)/g,
    (match, prefix: string, key: string) =>
      isSecretField(key) ? `${prefix}"${REDACTED}"` : match,
  );
}

/** Data message topic of the call key exchange (see rtc/e2ee/session.ts). */
export const E2EE_TOPIC = "anytalk:e2ee";

/**
 * Fields of key exchange messages that hold key material: `ct` is the media
 * key wrapped for one recipient and `iv` the wrap's initialisation vector.
 * The sender, recipient, epoch and nonce are not secret.
 */
const E2EE_SECRET_FIELDS = new Set(["ct", "iv"]);

/**
 * Redact the key material of a call key exchange message. The public keys of
 * the hello attribute are not touched (they are public by design).
 */
export function redactE2eeText(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        out[key] = E2EE_SECRET_FIELDS.has(key) ? REDACTED : value;
      }
      return JSON.stringify(out);
    }
  } catch {
    // cut off or not JSON: fall through to the pattern
  }
  return text.replace(
    /("(?:ct|iv)"\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,}\]\s]+)/g,
    (_match, prefix: string) => `${prefix}"${REDACTED}"`,
  );
}

/**
 * Redact the preview text of a body summary.
 */
function redactBody(body: BodySummary, secretRoute: boolean): BodySummary {
  if (body.kind !== "text") return body;
  return {
    ...body,
    text: secretRoute ? REDACTED : redactJsonText(body.text),
  };
}

/**
 * Redact the text of a preview string.
 */
function redactPreview(text: string, secretRoute: boolean): string {
  return secretRoute ? REDACTED : redactJsonText(text);
}

/**
 * Redact an entry for display or export. The stored entry is not changed.
 */
export function redactEntry<T extends TrafficEntry>(entry: T): T {
  switch (entry.kind) {
    case "http": {
      const e = entry as HttpEntry;
      const secretRoute = isSecretRoute(e.url);
      const out: HttpEntry = {
        ...e,
        url: redactUrl(e.url),
        error: e.error === undefined ? undefined : redactJsonText(e.error),
        requestHeaders: redactHeaders(e.requestHeaders),
        responseHeaders: redactHeaders(e.responseHeaders),
        requestBody: redactBody(e.requestBody, secretRoute),
        responsePreview:
          e.responsePreview === undefined
            ? undefined
            : redactPreview(e.responsePreview, secretRoute),
      };
      return out as T;
    }
    case "ws": {
      const e = entry as WsEntry;
      const out: WsEntry = {
        ...e,
        url: redactUrl(e.url),
        text: e.text === undefined ? undefined : redactJsonText(e.text),
        // `hex` is only the first 32 bytes of a binary frame: too short to
        // hold a token or key, so it is shown as is
        reason: e.reason === undefined ? undefined : redactJsonText(e.reason),
      };
      return out as T;
    }
    case "resource": {
      const e = entry as ResourceEntry;
      return { ...e, url: redactUrl(e.url) } as T;
    }
    case "call-info": {
      const e = entry as CallInfoEntry;
      return { ...e, url: redactUrl(e.url) } as T;
    }
    case "call-data": {
      const e = entry as CallDataEntry;
      const preview =
        e.topic === E2EE_TOPIC
          ? redactE2eeText(e.preview)
          : redactJsonText(e.preview);
      return { ...e, preview } as T;
    }
    case "call-attribute": {
      const e = entry as CallAttributeEntry;
      return {
        ...e,
        attributes: e.attributes.map(({ key, value }) => ({
          key,
          value: isSecretField(key) ? REDACTED : redactJsonText(value),
        })),
      } as T;
    }
    case "call-connection":
    case "call-bytes":
      // addresses and byte counts are what the inspector exists to show
      return entry;
  }
}
