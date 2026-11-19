import type { API } from "stoat.js";

import {
  type CredentialJson,
  type OptionsJson,
  credentialToJson,
  isWebAuthnSupported,
  parseCreationOptions,
  parseRequestOptions,
} from "./webauthn";

/** A passkey registered on the account */
export type Passkey = {
  id: string;
  name: string;
  created_at: string;
  last_used?: string;
};

/** A challenge from the server: ask the browser to sign or create with it */
export type PasskeyChallenge = {
  challenge_id: string;
  options: OptionsJson;
};

/** Result of finishing a registration */
export type PasskeyRegistration = {
  passkey: Passkey;
  /** Only set when the account had none: the first passkey turns 2FA on */
  recovery_codes?: string[];
};

/** MFA response answering with a passkey */
export type WebAuthnMfaResponse = {
  webauthn: { challenge_id: string; credential: CredentialJson };
};

/** The account's 2FA status including passkeys */
export type MfaStatus = {
  totp_mfa?: boolean;
  security_key_mfa?: boolean;
  recovery_active?: boolean;
};

/** An error answer from the server */
export class PasskeyApiError extends Error {
  /** HTTP status */
  status: number;

  /** Stoat error type, e.g. `InvalidCredentials` */
  type?: string;

  /**
   * Create the error
   * @param status HTTP status
   * @param type Stoat error type
   */
  constructor(status: number, type?: string) {
    super(`Passkey request failed: ${status} ${type ?? ""}`);
    this.status = status;
    this.type = type;
  }
}

/**
 * Whether an error means the server does not know the passkey routes (it
 * runs without the passkey patch)
 * @param error Error from a passkey request
 */
export function isUnsupportedByServer(error: unknown): boolean {
  return (
    error instanceof PasskeyApiError &&
    (error.status === 404 || error.status === 405)
  );
}

/**
 * Send a request to the passkey routes. They are newer than the generated API
 * types and the API layer drops bodies for unknown routes, so this builds the
 * request from the API's own base URL and auth headers (like qrApi does).
 * @param api API client (authenticated or not)
 * @param method HTTP method
 * @param path Path below `/auth`
 * @param body JSON body
 * @param ticket MFA ticket token to send, if the route needs one
 */
async function passkeyRequest<T>(
  api: API.API,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  ticket?: string,
): Promise<T> {
  const { baseURL, headers } = api.config as {
    baseURL: string;
    headers: Record<string, string>;
  };

  const response = await fetch(`${baseURL}/auth${path}`, {
    method,
    headers: {
      ...headers,
      ...(ticket ? { "X-MFA-Ticket": ticket } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let type: string | undefined;
    try {
      type = (await response.json())?.type;
    } catch {
      // body was not JSON
    }
    throw new PasskeyApiError(response.status, type);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Make sure an id is safe to put in a URL path
 * @param id Passkey id
 */
function assertId(id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new PasskeyApiError(404, "NotFound");
}

/**
 * Fetch the 2FA status, which includes whether passkeys exist
 * @param api Authenticated API
 */
export function fetchMfaStatus(api: API.API) {
  return passkeyRequest<MfaStatus>(api, "GET", "/mfa");
}

/**
 * List the account's passkeys. Fails with a 404 on a server without passkeys.
 * @param api Authenticated API
 */
export function listPasskeys(api: API.API) {
  return passkeyRequest<Passkey[]>(api, "GET", "/mfa/passkeys");
}

/**
 * Start registering a passkey (spends the MFA ticket)
 * @param api Authenticated API
 * @param ticket MFA ticket token
 */
export function startPasskeyRegistration(api: API.API, ticket: string) {
  return passkeyRequest<PasskeyChallenge>(
    api,
    "POST",
    "/mfa/passkeys/register",
    undefined,
    ticket,
  );
}

/**
 * Finish registering a passkey
 * @param api Authenticated API
 * @param challenge_id Challenge the credential answers
 * @param name Name to show in the list
 * @param credential Credential from the browser
 */
export function finishPasskeyRegistration(
  api: API.API,
  challenge_id: string,
  name: string,
  credential: CredentialJson,
) {
  return passkeyRequest<PasskeyRegistration>(
    api,
    "POST",
    "/mfa/passkeys/register/finish",
    { challenge_id, name, credential },
  );
}

/**
 * Rename a passkey
 * @param api Authenticated API
 * @param id Passkey id
 * @param name New name
 */
export function renamePasskey(api: API.API, id: string, name: string) {
  assertId(id);
  return passkeyRequest<unknown>(api, "PATCH", `/mfa/passkeys/${id}`, {
    name,
  });
}

/**
 * Remove a passkey (spends the MFA ticket)
 * @param api Authenticated API
 * @param id Passkey id
 * @param ticket MFA ticket token
 */
export function deletePasskey(api: API.API, id: string, ticket: string) {
  assertId(id);
  return passkeyRequest<void>(
    api,
    "DELETE",
    `/mfa/passkeys/${id}`,
    undefined,
    ticket,
  );
}

/**
 * Ask for a challenge to sign in without a password (no auth)
 * @param api Unauthenticated API
 */
export function startPasskeyLogin(api: API.API) {
  return passkeyRequest<PasskeyChallenge>(
    api,
    "POST",
    "/session/passkey/start",
  );
}

/**
 * Finish a passwordless sign-in. Answers like a password login does.
 * @param api Unauthenticated API
 * @param challenge_id Challenge the credential answers
 * @param credential Credential from the browser
 * @param friendly_name Name of this device
 */
export function finishPasskeyLogin(
  api: API.API,
  challenge_id: string,
  credential: CredentialJson,
  friendly_name?: string,
) {
  return passkeyRequest<API.ResponseLogin>(
    api,
    "POST",
    "/session/passkey/finish",
    { challenge_id, credential, friendly_name },
  );
}

/**
 * Ask for a challenge for the MFA step
 * @param api API client
 * @param mfa_ticket Login MFA ticket, while logging in (otherwise the session
 * is used)
 */
export function startWebAuthnMfa(api: API.API, mfa_ticket?: string) {
  return passkeyRequest<PasskeyChallenge>(
    api,
    "POST",
    "/mfa/webauthn/challenge",
    {
      mfa_ticket,
    },
  );
}

/**
 * Ask the browser to sign a challenge with a passkey
 * @param options Options from the server
 * @param extra Conditional mediation and abort signal for the autofill flow
 * @returns The credential, or null if the browser gave none
 */
export async function getPasskeyCredential(
  options: OptionsJson,
  extra?: { mediation?: CredentialMediationRequirement; signal?: AbortSignal },
): Promise<CredentialJson | null> {
  const credential = (await navigator.credentials.get({
    publicKey: parseRequestOptions(options),
    mediation: extra?.mediation,
    signal: extra?.signal,
  })) as PublicKeyCredential | null;
  return credential ? credentialToJson(credential) : null;
}

/**
 * Ask the browser to create a new passkey
 * @param options Options from the server
 * @returns The credential, or null if the browser gave none
 */
export async function createPasskeyCredential(
  options: OptionsJson,
): Promise<CredentialJson | null> {
  const credential = (await navigator.credentials.create({
    publicKey: parseCreationOptions(options),
  })) as PublicKeyCredential | null;
  return credential ? credentialToJson(credential) : null;
}

/**
 * Run the passkey prompt for an MFA step and build the MFA response
 * @param api API client
 * @param mfa_ticket Login MFA ticket, while logging in
 * @returns The response, or undefined if the browser gave no credential
 */
export async function answerWithPasskey(
  api: API.API,
  mfa_ticket?: string,
): Promise<WebAuthnMfaResponse | undefined> {
  return answerWithChallenge(await startWebAuthnMfa(api, mfa_ticket));
}

/**
 * Run the passkey prompt for a challenge fetched earlier. Fetching ahead
 * matters on Safari, which only allows the prompt right after a tap.
 * @param challenge Challenge from `startWebAuthnMfa`
 * @returns The response, or undefined if the browser gave no credential
 */
export async function answerWithChallenge(
  challenge: PasskeyChallenge,
): Promise<WebAuthnMfaResponse | undefined> {
  const credential = await getPasskeyCredential(challenge.options);
  return credential
    ? { webauthn: { challenge_id: challenge.challenge_id, credential } }
    : undefined;
}

/**
 * Whether the app should offer passkeys at all: the browser can do them.
 * (Whether the server can is found out by asking it.)
 */
export const passkeysSupportedByBrowser = isWebAuthnSupported;

/**
 * Whether an MFA method list contains passkeys. stoat.js's method type does
 * not know `WebAuthn`, so this compares as text.
 * @param methods Allowed methods from the server
 */
export function allowsWebAuthn(methods?: readonly string[]): boolean {
  return !!methods?.includes("WebAuthn");
}

/**
 * Default name offered for a new passkey
 * @param existing Passkeys the account already has
 * @param base Base name, e.g. "Passkey"
 */
export function defaultPasskeyName(
  existing: readonly Passkey[],
  base: string,
): string {
  const names = new Set(existing.map((entry) => entry.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}
