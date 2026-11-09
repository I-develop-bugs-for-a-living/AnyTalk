/**
 * Pure WebCrypto building blocks for AnyTalk call end-to-end encryption.
 *
 * Works in the browser and in Node (`globalThis.crypto.subtle`), has no
 * dependency on LiveKit and holds no state. Key material never leaves this
 * file except as raw bytes the caller asked for.
 */

/** Wire protocol version, bumped on incompatible changes. */
export const PROTOCOL_VERSION = 1;

/** Length in bytes of an uncompressed P-256 public key. */
export const PUBLIC_KEY_LENGTH = 65;

/** Length in bytes of an ECDSA P-256 signature (IEEE P1363 format). */
export const SIGNATURE_LENGTH = 64;

/** Length in bytes of a media key (128 bit, the only size non-web SDKs accept). */
export const MEDIA_KEY_LENGTH = 16;

/** Length in bytes of an AES-GCM IV. */
const IV_LENGTH = 12;

const encoder = new TextEncoder();

/**
 * Accepts a byte array as WebCrypto input (TypeScript 6 distinguishes
 * `ArrayBuffer` from `ArrayBufferLike` backed arrays).
 */
function bs(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

/** Returns the subtle crypto implementation of the current environment. */
function subtle(): SubtleCrypto {
  return globalThis.crypto.subtle;
}

/** Encodes bytes as unpadded base64url. */
export function b64uEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decodes unpadded base64url. Throws on malformed or non-canonical input. */
export function b64uDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invalid base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  // reject non-canonical encodings (e.g. non-zero trailing bits): the same
  // bytes must have exactly one text form, or attribute strings are malleable
  if (b64uEncode(out) !== text) throw new Error("non-canonical base64url");
  return out;
}

/** Returns `length` cryptographically random bytes. */
export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Compares two byte arrays for equality. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** A key pair with a non-extractable private key and its raw public key. */
export interface RawKeyPair {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
}

/** Per-call ECDH key pair. */
export type CallKeyPair = RawKeyPair;

/** Long-term device identity (ECDSA) key pair. */
export type DeviceIdentity = RawKeyPair;

/** Throws unless the bytes look like an uncompressed P-256 point. */
function assertRawPublicKey(raw: Uint8Array): void {
  if (raw.length !== PUBLIC_KEY_LENGTH || raw[0] !== 0x04) {
    throw new Error("invalid public key");
  }
}

/** Generates a per-call ECDH P-256 key pair with a non-extractable private key. */
export async function generateCallKeyPair(): Promise<CallKeyPair> {
  const pair = await subtle().generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return {
    privateKey: pair.privateKey,
    publicRaw: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)),
  };
}

/** Imports a raw 65 byte P-256 public key for ECDH. Throws on invalid points. */
export async function importCallPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  assertRawPublicKey(raw);
  return subtle().importKey(
    "raw",
    bs(raw),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

/** Exports a public key as raw 65 bytes. */
export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().exportKey("raw", key));
}

/** Generates a random 128 bit media key. */
export function generateMediaKey(): Uint8Array {
  return randomBytes(MEDIA_KEY_LENGTH);
}

/** Context that binds a wrapped key to one call, direction and key index. */
export interface WrapContext {
  callId: string;
  from: string;
  to: string;
  keyIndex: number;
}

/** Encodes the AES-GCM additional authenticated data for a wrap context. */
function wrapAad(context: WrapContext): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      "anytalk-e2ee-aad",
      context.callId,
      context.from,
      context.to,
      context.keyIndex,
    ]),
  );
}

/**
 * Derives the AES-GCM wrapping key
 * `HKDF-SHA256(ECDH(myPriv, peerPub), salt = callId, info = "anytalk-e2ee-wrap|from|to|index")`.
 */
async function deriveWrapKey(
  privateKey: CryptoKey,
  peerPublicRaw: Uint8Array,
  context: WrapContext,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const peer = await importCallPublicKey(peerPublicRaw);
  const secret = await subtle().deriveBits(
    { name: "ECDH", public: peer },
    privateKey,
    256,
  );
  const material = await subtle().importKey("raw", secret, "HKDF", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(context.callId),
      info: encoder.encode(
        `anytalk-e2ee-wrap|${context.from}|${context.to}|${context.keyIndex}`,
      ),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/** A wrapped media key as sent over the wire. */
export interface WrappedKey {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Wraps a media key for exactly one recipient. The context (call, sender,
 * recipient, key index) feeds both the key derivation and the AAD, so the
 * result cannot be replayed to another recipient, call or index.
 */
export async function wrapMediaKey(
  privateKey: CryptoKey,
  peerPublicRaw: Uint8Array,
  context: WrapContext,
  mediaKey: Uint8Array,
): Promise<WrappedKey> {
  const key = await deriveWrapKey(
    privateKey,
    peerPublicRaw,
    context,
    "encrypt",
  );
  const iv = randomBytes(IV_LENGTH);
  const ciphertext = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: bs(iv), additionalData: bs(wrapAad(context)) },
      key,
      bs(mediaKey),
    ),
  );
  return { iv, ciphertext };
}

/** Unwraps a media key. Throws if the context, keys or ciphertext do not match. */
export async function unwrapMediaKey(
  privateKey: CryptoKey,
  peerPublicRaw: Uint8Array,
  context: WrapContext,
  wrapped: WrappedKey,
): Promise<Uint8Array> {
  if (wrapped.iv.length !== IV_LENGTH) throw new Error("invalid iv");
  const key = await deriveWrapKey(
    privateKey,
    peerPublicRaw,
    context,
    "decrypt",
  );
  const plain = new Uint8Array(
    await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: bs(wrapped.iv),
        additionalData: bs(wrapAad(context)),
      },
      key,
      bs(wrapped.ciphertext),
    ),
  );
  if (plain.length !== MEDIA_KEY_LENGTH) throw new Error("invalid key length");
  return plain;
}

/** Generates a long-term ECDSA P-256 device identity (private key non-extractable). */
export async function generateIdentity(): Promise<DeviceIdentity> {
  const pair = await subtle().generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  return {
    privateKey: pair.privateKey,
    publicRaw: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)),
  };
}

/** Builds the signed message of a hello: binds identity to call, user and call key. */
function helloMessage(
  callId: string,
  userId: string,
  callPublicRaw: Uint8Array,
): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      "anytalk-e2ee-hello",
      callId,
      userId,
      b64uEncode(callPublicRaw),
    ]),
  );
}

/** Signs the per-call public key together with call id and user id. */
export async function signHello(
  identityPrivateKey: CryptoKey,
  callId: string,
  userId: string,
  callPublicRaw: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle().sign(
      { name: "ECDSA", hash: "SHA-256" },
      identityPrivateKey,
      bs(helloMessage(callId, userId, callPublicRaw)),
    ),
  );
}

/** Verifies a hello signature. Returns false (never throws) on any problem. */
export async function verifyHello(
  identityPublicRaw: Uint8Array,
  callId: string,
  userId: string,
  callPublicRaw: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    assertRawPublicKey(identityPublicRaw);
    if (signature.length !== SIGNATURE_LENGTH) return false;
    const key = await subtle().importKey(
      "raw",
      bs(identityPublicRaw),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await subtle().verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      bs(signature),
      bs(helloMessage(callId, userId, callPublicRaw)),
    );
  } catch {
    return false;
  }
}

/** SHA-256 of the identity public key as base64url: the stable id used for pinning. */
export async function identityFingerprint(
  identityPublicRaw: Uint8Array,
): Promise<string> {
  return b64uEncode(
    new Uint8Array(await subtle().digest("SHA-256", bs(identityPublicRaw))),
  );
}

/** A stored device identity, as persisted by an {@link IdentityStore}. */
export interface StoredIdentity {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
}

/**
 * Storage for the long-term device identity.
 *
 * `load` resolves `undefined` only when nothing is stored and rejects on any
 * read error, so callers can tell "missing" from "unreadable". `addIfAbsent`
 * must be atomic (e.g. IndexedDB `add`): it resolves `false` when an identity
 * already exists, which is how two tabs racing to create one are resolved.
 */
export interface IdentityStore {
  /** Returns the stored identity, `undefined` if none; rejects on errors. */
  load(): Promise<StoredIdentity | undefined>;
  /** Stores the identity unless one exists. Resolves whether it was stored. */
  addIfAbsent(identity: StoredIdentity): Promise<boolean>;
}

/** Checks a loaded value: ECDSA private CryptoKey, non-extractable, 65 byte public key. */
function isValidIdentity(value: unknown): value is StoredIdentity {
  const v = value as StoredIdentity | undefined;
  return (
    !!v &&
    typeof CryptoKey !== "undefined" &&
    v.privateKey instanceof CryptoKey &&
    v.privateKey.type === "private" &&
    v.privateKey.extractable === false &&
    v.privateKey.algorithm.name === "ECDSA" &&
    v.publicRaw instanceof Uint8Array &&
    v.publicRaw.length === PUBLIC_KEY_LENGTH &&
    v.publicRaw[0] === 0x04
  );
}

/** In-memory identities used when a store is unreadable, kept for the page's life. */
const fallbackIdentities = new WeakMap<IdentityStore, DeviceIdentity>();

/**
 * Loads the device identity, creating one if the store has none.
 *
 * Every store access is wrapped in try/catch. If the store cannot be read, or
 * holds an invalid record, an in-memory identity is used and the stored
 * record is never overwritten. If another tab created an identity first
 * (`addIfAbsent` returns false), that one is re-read and used.
 */
export async function loadOrCreateIdentity(
  store: IdentityStore,
): Promise<DeviceIdentity> {
  const fallback = async () => {
    let identity = fallbackIdentities.get(store);
    if (!identity) {
      identity = await generateIdentity();
      fallbackIdentities.set(store, identity);
    }
    return identity;
  };
  let existing: StoredIdentity | undefined;
  try {
    existing = await store.load();
  } catch {
    return fallback();
  }
  if (existing !== undefined) {
    return isValidIdentity(existing) ? existing : fallback();
  }
  const created = await generateIdentity();
  try {
    if (await store.addIfAbsent(created)) return created;
    const winner = await store.load();
    return isValidIdentity(winner) ? winner : fallback();
  } catch {
    // could not persist: use it for this page only
    fallbackIdentities.set(store, created);
    return created;
  }
}
