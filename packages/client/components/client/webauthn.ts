/**
 * Conversion between the JSON the server speaks (binary fields as base64url)
 * and the objects the browser's WebAuthn API wants. Uses the browser's own
 * parse / toJSON helpers when they exist and a manual conversion otherwise
 * (older Safari and Firefox versions lack them).
 */

/** Options as the server sends them: `{ publicKey: { ... } }` */
export type OptionsJson = { publicKey: Record<string, unknown> };

/** A credential as JSON, ready to send to the server */
export type CredentialJson = Record<string, unknown>;

/**
 * Whether this browser can do passkeys at all
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    !!navigator.credentials
  );
}

/**
 * Whether the browser can fill passkeys into a text field's autofill list
 */
export async function isConditionalMediationAvailable(): Promise<boolean> {
  try {
    return (
      isWebAuthnSupported() &&
      typeof PublicKeyCredential.isConditionalMediationAvailable ===
        "function" &&
      (await PublicKeyCredential.isConditionalMediationAvailable())
    );
  } catch {
    return false;
  }
}

/**
 * Decode base64url text to bytes
 * @param value base64url text (padding optional)
 */
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode bytes as base64url text without padding
 * @param buffer Bytes to encode
 */
export function bytesToBase64url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Turn a `{ id }` descriptor's base64url id into bytes
 * @param list Descriptors from the options, if any
 */
function convertDescriptors(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((entry) =>
    entry && typeof entry === "object" && typeof entry.id === "string"
      ? { ...entry, id: base64urlToBytes(entry.id) }
      : entry,
  );
}

/**
 * Manual conversion of request options (sign in) for browsers without
 * `PublicKeyCredential.parseRequestOptionsFromJSON`
 * @param json Options from the server
 */
export function manualRequestOptions(
  json: OptionsJson,
): PublicKeyCredentialRequestOptions {
  const { challenge, allowCredentials, ...rest } = json.publicKey;
  return {
    ...rest,
    challenge: base64urlToBytes(challenge as string),
    ...(allowCredentials === undefined
      ? {}
      : { allowCredentials: convertDescriptors(allowCredentials) }),
  } as unknown as PublicKeyCredentialRequestOptions;
}

/**
 * Manual conversion of creation options (register) for browsers without
 * `PublicKeyCredential.parseCreationOptionsFromJSON`
 * @param json Options from the server
 */
export function manualCreationOptions(
  json: OptionsJson,
): PublicKeyCredentialCreationOptions {
  const { challenge, user, excludeCredentials, ...rest } = json.publicKey;
  const account = user as { id: string };
  return {
    ...rest,
    challenge: base64urlToBytes(challenge as string),
    user: { ...account, id: base64urlToBytes(account.id) },
    ...(excludeCredentials === undefined
      ? {}
      : { excludeCredentials: convertDescriptors(excludeCredentials) }),
  } as unknown as PublicKeyCredentialCreationOptions;
}

/**
 * Options for `navigator.credentials.get`
 * @param json Options from the server
 */
export function parseRequestOptions(
  json: OptionsJson,
): PublicKeyCredentialRequestOptions {
  if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function") {
    try {
      return PublicKeyCredential.parseRequestOptionsFromJSON(
        json.publicKey as unknown as PublicKeyCredentialRequestOptionsJSON,
      );
    } catch {
      // the native parser is strict about unknown fields: convert by hand
    }
  }
  return manualRequestOptions(json);
}

/**
 * Options for `navigator.credentials.create`
 * @param json Options from the server
 */
export function parseCreationOptions(
  json: OptionsJson,
): PublicKeyCredentialCreationOptions {
  if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function") {
    try {
      return PublicKeyCredential.parseCreationOptionsFromJSON(
        json.publicKey as unknown as PublicKeyCredentialCreationOptionsJSON,
      );
    } catch {
      // see parseRequestOptions
    }
  }
  return manualCreationOptions(json);
}

/**
 * Manual `toJSON` for browsers that lack it
 * @param credential Credential from create or get
 */
export function manualCredentialToJson(
  credential: PublicKeyCredential,
): CredentialJson {
  const response = credential.response as AuthenticatorAttestationResponse &
    AuthenticatorAssertionResponse;
  const out: Record<string, unknown> = {
    clientDataJSON: bytesToBase64url(response.clientDataJSON),
  };

  if (response.attestationObject) {
    // registration
    out.attestationObject = bytesToBase64url(response.attestationObject);
    if (typeof response.getTransports === "function") {
      out.transports = response.getTransports();
    }
  } else {
    // sign in
    out.authenticatorData = bytesToBase64url(response.authenticatorData);
    out.signature = bytesToBase64url(response.signature);
    // sent unchanged: the server looks the account up by it
    if (response.userHandle) {
      out.userHandle = bytesToBase64url(response.userHandle);
    }
  }

  return {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: out,
  };
}

/**
 * Credential as JSON for the server
 * @param credential Credential from create or get
 */
export function credentialToJson(
  credential: PublicKeyCredential,
): CredentialJson {
  if (typeof credential.toJSON === "function") {
    return credential.toJSON() as unknown as CredentialJson;
  }
  return manualCredentialToJson(credential);
}

/**
 * Whether an error just means the user dismissed the browser prompt (or it
 * timed out), which needs no message
 * @param error Error thrown by the credentials API
 */
export function isPromptCancelled(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}
