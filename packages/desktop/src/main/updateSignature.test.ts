// Run with `pnpm --filter anytalk-desktop run test` (node's test runner).
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import { TRUSTED_UPDATE_KEYS } from "./trustedUpdateKeys.ts";
import {
  formatSignatureLine,
  keyIdOf,
  signedMessage,
  verifyUpdateSignature,
} from "./updateSignature.ts";

/** Make a throwaway key pair in the formats the app uses. */
function makeKey(owner: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    id: keyIdOf(publicKey),
    trusted: {
      owner,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
  };
}

/** Sign like `sign-update` does and return the `.sig` line. */
function sigLine(
  key: ReturnType<typeof makeKey>,
  fileName: string,
  sha512Hex: string,
) {
  const signature = sign(
    null,
    signedMessage(VERSION, fileName, sha512Hex),
    key.privateKey,
  );
  return formatSignatureLine(key.id, signature);
}

const VERSION = "1.0.0";
const FILE = "AnyTalk-Setup-1.0.0.exe";
const HASH = "ab".repeat(64);

test("accepts a good signature", () => {
  const alice = makeKey("alice");
  const result = verifyUpdateSignature({
    sigText: sigLine(alice, FILE, HASH) + "\n",
    version: VERSION,
    fileName: FILE,
    sha512Hex: HASH,
    trustedKeys: [alice.trusted],
  });
  assert.equal(result, "alice");
});

test("rejects a key that is not trusted", () => {
  const alice = makeKey("alice");
  const mallory = makeKey("mallory");
  assert.equal(
    verifyUpdateSignature({
      sigText: sigLine(mallory, FILE, HASH),
      version: VERSION,
      fileName: FILE,
      sha512Hex: HASH,
      trustedKeys: [alice.trusted],
    }),
    null,
  );
});

test("rejects a signature made by another key under a trusted key id", () => {
  const alice = makeKey("alice");
  const mallory = makeKey("mallory");
  const forged = formatSignatureLine(
    alice.id,
    sign(null, signedMessage(VERSION, FILE, HASH), mallory.privateKey),
  );
  assert.equal(
    verifyUpdateSignature({
      sigText: forged,
      version: VERSION,
      fileName: FILE,
      sha512Hex: HASH,
      trustedKeys: [alice.trusted],
    }),
    null,
  );
});

test("rejects a tampered file or a renamed asset", () => {
  const alice = makeKey("alice");
  const sigText = sigLine(alice, FILE, HASH);
  const base = { sigText, trustedKeys: [alice.trusted] };
  assert.equal(
    verifyUpdateSignature({
      ...base,
      version: VERSION,
      fileName: FILE,
      sha512Hex: "cd".repeat(64),
    }),
    null,
  );
  assert.equal(
    verifyUpdateSignature({
      ...base,
      version: VERSION,
      fileName: "Other.exe",
      sha512Hex: HASH,
    }),
    null,
  );
});

test("rejects everything with an empty key list", () => {
  const alice = makeKey("alice");
  assert.equal(
    verifyUpdateSignature({
      sigText: sigLine(alice, FILE, HASH),
      version: VERSION,
      fileName: FILE,
      sha512Hex: HASH,
      trustedKeys: [],
    }),
    null,
  );
});

test("rejects empty and garbage signature files", () => {
  const alice = makeKey("alice");
  for (const sigText of [
    "",
    "\n",
    "garbage",
    `${alice.id} !!!`,
    `${alice.id}`,
  ]) {
    assert.equal(
      verifyUpdateSignature({
        sigText,
        version: VERSION,
        fileName: FILE,
        sha512Hex: HASH,
        trustedKeys: [alice.trusted],
      }),
      null,
    );
  }
});

test("with several keys, any one valid signature is enough", () => {
  const alice = makeKey("alice");
  const bob = makeKey("bob");
  const mallory = makeKey("mallory");
  const trustedKeys = [alice.trusted, bob.trusted];
  // Only bob signed; the file also carries an unknown key's line
  const sigText = [sigLine(mallory, FILE, HASH), sigLine(bob, FILE, HASH)].join(
    "\n",
  );
  assert.equal(
    verifyUpdateSignature({
      sigText,
      version: VERSION,
      fileName: FILE,
      sha512Hex: HASH,
      trustedKeys,
    }),
    "bob",
  );
});

test("a malformed trusted entry trusts nothing", () => {
  const alice = makeKey("alice");
  assert.equal(
    verifyUpdateSignature({
      sigText: sigLine(alice, FILE, HASH),
      version: VERSION,
      fileName: FILE,
      sha512Hex: HASH,
      trustedKeys: [{ owner: "broken", publicKey: "not a key" }],
    }),
    null,
  );
});

test("rejects an older signed installer offered as a newer version", () => {
  const alice = makeKey("alice");
  const sigText = sigLine(alice, FILE, HASH);
  // latest.yml claims 2.0.0 but points at the signed 1.0.0 installer
  assert.equal(
    verifyUpdateSignature({
      sigText,
      version: "2.0.0",
      fileName: FILE,
      sha512Hex: HASH,
      trustedKeys: [alice.trusted],
    }),
    null,
  );
  // same file name check alone: signature for 2.0.0 on a 1.0.0-named file
  const wrong = formatSignatureLine(
    alice.id,
    sign(null, signedMessage("2.0.0", FILE, HASH), alice.privateKey),
  );
  assert.equal(
    verifyUpdateSignature({
      sigText: wrong,
      version: "2.0.0",
      fileName: FILE,
      sha512Hex: HASH,
      trustedKeys: [alice.trusted],
    }),
    null,
  );
});

test("the shipped trusted key list is not empty and holds ed25519 keys", () => {
  assert.ok(TRUSTED_UPDATE_KEYS.length >= 1);
  for (const entry of TRUSTED_UPDATE_KEYS) {
    assert.ok(entry.owner);
    assert.equal(keyIdOf(entry.publicKey).length, 16);
    assert.equal(createPublicKey(entry.publicKey).asymmetricKeyType, "ed25519");
  }
});
