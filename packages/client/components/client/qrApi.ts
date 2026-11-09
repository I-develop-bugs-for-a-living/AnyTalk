import { detect } from "detect-browser";
import type { API } from "stoat.js";

import { isQrLoginId } from "./qrLoginCode";

/** Status of a QR login request, as returned by polling */
export type QrPollResult =
  | { status: "pending" | "scanned" | "denied" | "expired" }
  | {
      status: "approved";
      session: {
        _id: string;
        user_id: string;
        token: string;
        name: string;
        last_seen: string;
      };
    };

/** A freshly created QR login request */
export type QrRequest = {
  id: string;
  secret: string;
  expires_at: string;
};

/** Proof asked for when approving */
export type QrApproveMethod = "password" | "totp_or_recovery";

/** Proof sent along with an approval */
export type QrApproveProof =
  | { password: string }
  | { totp_code: string }
  | { recovery_code: string };

/** What the approving device learns about a request */
export type QrInfo = {
  friendly_name?: string;
  /** Coarse IP of the requesting device */
  ip?: string;
  /** User-Agent of the requesting device */
  user_agent?: string;
  created_at: string;
  expires_at: string;
  /** Which proof the approving device must give */
  method: QrApproveMethod;
};

/** An error answer from the server */
export class QrApiError extends Error {
  /** HTTP status */
  status: number;

  /** Stoat error type, e.g. `NotFound` or `InvalidToken` */
  type?: string;

  /**
   * Create the error
   * @param status HTTP status
   * @param type Stoat error type
   */
  constructor(status: number, type?: string) {
    super(`QR login request failed: ${status} ${type ?? ""}`);
    this.status = status;
    this.type = type;
  }
}

/**
 * Send a request to a `/auth/session/qr` route (or, with a prefix, another
 * route). These routes are newer than
 * the generated API types and the API layer drops bodies for unknown routes,
 * so this builds the request from the API's own base URL and auth headers.
 * @param api API client (authenticated or not)
 * @param method HTTP method
 * @param path Path below `/auth/session/qr`
 * @param body JSON body
 * @param explicitHeaders Headers to send instead of the API's own
 * @param prefix Path prefix
 * @param keepalive Let the request outlive the page
 */
async function qrRequest<T>(
  api: API.API,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  explicitHeaders?: Record<string, string>,
  prefix = "/auth/session/qr",
  keepalive = false,
): Promise<T> {
  const { baseURL, headers } = api.config as {
    baseURL: string;
    headers: Record<string, string>;
  };

  const response = await fetch(`${baseURL}${prefix}${path}`, {
    method,
    headers: {
      // explicit headers replace the API's own, so no other credentials leak
      ...(explicitHeaders ?? headers),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive,
  });

  if (!response.ok) {
    let type: string | undefined;
    try {
      type = (await response.json())?.type;
    } catch {
      // body was not JSON
    }
    throw new QrApiError(response.status, type);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Ask for a new QR login request (new device, no auth)
 * @param api Unauthenticated API
 * @param friendly_name Name of this device
 */
export function createQrRequest(api: API.API, friendly_name?: string) {
  return qrRequest<QrRequest>(api, "POST", "", { friendly_name });
}

/**
 * Check on a request (new device, no auth)
 * @param api Unauthenticated API
 * @param id Request id
 * @param secret Secret kept on this device
 */
export function pollQrRequest(api: API.API, id: string, secret: string) {
  return qrRequest<QrPollResult>(api, "POST", `/${id}/poll`, { secret });
}

/**
 * Look at a scanned request, which marks it as scanned (logged-in device)
 * @param api Authenticated API
 * @param id Request id
 */
export function getQrInfo(api: API.API, id: string) {
  assertId(id);
  return qrRequest<QrInfo>(api, "POST", `/${id}/info`);
}

/**
 * Approve a request (logged-in device)
 * @param api Authenticated API
 * @param id Request id
 * @param mfa_response Second factor, if the account has one
 */
export function approveQrRequest(
  api: API.API,
  id: string,
  mfa_response?: QrApproveProof,
) {
  assertId(id);
  return qrRequest<void>(api, "POST", `/${id}/approve`, { mfa_response });
}

/**
 * Deny a request (logged-in device)
 * @param api Authenticated API
 * @param id Request id
 */
export function denyQrRequest(api: API.API, id: string) {
  assertId(id);
  return qrRequest<void>(api, "POST", `/${id}/deny`, {});
}

/**
 * Whether closing the approve dialog should deny the request. A request that
 * was neither answered nor already gone would otherwise stay "scanned" and keep
 * the new device waiting until it expires.
 * @param answered The user approved or denied it already
 * @param gone The request failed to load or has expired
 */
export function shouldDenyOnClose(answered: boolean, gone: boolean): boolean {
  return !answered && !gone;
}

/**
 * Make sure an id is safe to put in a URL path
 * @param id Request id
 */
function assertId(id: string) {
  if (!isQrLoginId(id)) throw new QrApiError(404, "NotFound");
}

/**
 * Short readable "Browser on OS" for a User-Agent string
 * @param userAgent User-Agent header
 * @returns Description, or the shortened raw string when it is unknown
 */
export function describeUserAgent(userAgent?: string): string | undefined {
  if (!userAgent) return undefined;
  const info = detect(userAgent) as { name?: string; os?: string } | null;
  if (info?.name) {
    return info.os ? `${info.name} / ${info.os}` : info.name;
  }
  return userAgent.length > 60 ? `${userAgent.slice(0, 60)}...` : userAgent;
}

/** Account details shown before a QR login is finished */
export type QrAccount = { username: string; display_name?: string };

/**
 * Look up the account behind a session token (new device, before trusting it)
 * @param api Unauthenticated API
 * @param token Token of the session that was just approved
 */
export function fetchAccountWithToken(api: API.API, token: string) {
  return qrRequest<QrAccount>(
    api,
    "GET",
    "/users/@me",
    undefined,
    { "X-Session-Token": token },
    "",
  );
}

/**
 * Revoke a session using its own token (new device, login cancelled)
 * @param api Unauthenticated API
 * @param sessionId Id of the session
 * @param token Token of that session
 */
export function revokeSessionWithToken(
  api: API.API,
  sessionId: string,
  token: string,
  keepalive = false,
) {
  if (!/^[A-Za-z0-9]+$/.test(sessionId)) return Promise.resolve();
  return qrRequest<void>(
    api,
    "DELETE",
    `/auth/session/${sessionId}`,
    undefined,
    { "X-Session-Token": token },
    "",
    keepalive,
  );
}
