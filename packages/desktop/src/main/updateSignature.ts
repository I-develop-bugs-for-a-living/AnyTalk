// Independent signature check for desktop updates. The release on GitHub is
// not trusted by itself (anyone with write access could swap the installer
// and the sha512 in latest*.yml), so every release asset is also signed with
// an ed25519 key of a releaser, and the app only installs files signed by a
// key in `trustedUpdateKeys.ts`.
//
// Pure logic, no Electron imports: it is shared with the release scripts in
// `scripts/` and tested with `node --test` (see RELEASING.md).
import {
  type KeyObject,
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";
import { createReadStream } from "node:fs";

/** One trusted releaser key. */
export interface TrustedKey {
  /** Who owns the key, for humans and logs only */
  owner: string;
  /** The public key as PEM (SPKI), as printed by `gen-update-key` */
  publicKey: string;
}

/** First line of every signed message, so signatures can't be reused elsewhere. */
const MESSAGE_PREFIX = "anytalk-update-v1";

/** Hex length of a key id (first bytes of the SHA-256 of the key's SPKI DER). */
const KEY_ID_LENGTH = 16;

/**
 * Get the short id of a public key, used to match signatures to keys.
 *
 * @param key The public key (a KeyObject or SPKI PEM text)
 * @returns 16 hex characters
 */
export function keyIdOf(key: KeyObject | string): string {
  // createPublicKey also derives the public half of a private key
  const object =
    typeof key === "string" || key.type === "private"
      ? createPublicKey(key)
      : key;
  const der = object.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, KEY_ID_LENGTH);
}

/**
 * Hash a file with SHA-512 without loading it into memory.
 *
 * @param path The file to hash
 * @returns The lowercase hex digest
 */
export function sha512OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Build the exact bytes that get signed. It covers the version (so latest.yml,
 * which is unsigned, can't point a new version at an older signed installer),
 * the file name (so a signed installer can't be passed off as another asset)
 * and the SHA-512 of the content (ed25519 can't sign a stream, so the digest
 * is signed).
 *
 * @param version The release version, e.g. "0.3.2"
 * @param fileName The asset's file name, without directories
 * @param sha512Hex The SHA-512 of the file as lowercase hex
 * @returns The message to sign or verify
 */
export function signedMessage(
  version: string,
  fileName: string,
  sha512Hex: string,
): Buffer {
  return Buffer.from(
    `${MESSAGE_PREFIX}\n${version}\n${fileName}\n${sha512Hex}\n`,
    "utf8",
  );
}

/**
 * Format one line of a `.sig` file.
 *
 * @param keyId The signing key's id
 * @param signature The raw ed25519 signature
 * @returns `<keyId> <base64 signature>`
 */
export function formatSignatureLine(keyId: string, signature: Buffer): string {
  return `${keyId} ${signature.toString("base64")}`;
}

/**
 * Check a `.sig` file against the trusted keys. Accepts if at least one line
 * carries a valid signature from a trusted key; lines for unknown keys, bad
 * lines and bad signatures are skipped. Never throws.
 *
 * @param options.sigText The text of the `.sig` file
 * @param options.version The version the app was told it is installing
 * @param options.fileName The asset's file name
 * @param options.sha512Hex The SHA-512 of the downloaded file as hex
 * @param options.trustedKeys The keys to trust (an empty list rejects all)
 * @returns The owner of the key that signed it, or null if nothing verified
 */
export function verifyUpdateSignature(options: {
  sigText: string;
  version: string;
  fileName: string;
  sha512Hex: string;
  trustedKeys: readonly TrustedKey[];
}): string | null {
  const keys = new Map<string, { owner: string; key: KeyObject }>();
  for (const trusted of options.trustedKeys) {
    try {
      const key = createPublicKey(trusted.publicKey);
      if (key.asymmetricKeyType !== "ed25519") continue;
      keys.set(keyIdOf(key), { owner: trusted.owner, key });
    } catch {
      // a malformed entry must not trust anything
    }
  }
  if (keys.size === 0) return null;
  // The file name must belong to the version, a second guard against rollback
  if (!options.version || !options.fileName.includes(options.version))
    return null;

  const message = signedMessage(
    options.version,
    options.fileName,
    options.sha512Hex,
  );
  for (const line of options.sigText.split(/\r?\n/)) {
    const [keyId, encoded] = line.trim().split(/\s+/);
    const trusted = keyId ? keys.get(keyId) : undefined;
    if (!trusted || !encoded) continue;
    try {
      const signature = Buffer.from(encoded, "base64");
      if (cryptoVerify(null, message, trusted.key, signature))
        return trusted.owner;
    } catch {
      // try the next line
    }
  }
  return null;
}
