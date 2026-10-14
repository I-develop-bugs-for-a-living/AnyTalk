// Signs release artifacts for AnyTalk Desktop's update check.
//
//   node scripts/sign-update.mjs --version <version> --key <private-key.pem> <file>...
//
// For every file, writes <file>.sig next to it (one line: "<keyId> <base64>").
// If a .sig already exists, the new line is added and an existing line of the
// same key is replaced, so several releasers can each sign the same file.
// Sign the installers (.exe, .AppImage); signing the other artifacts is
// harmless.
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import {
  formatSignatureLine,
  keyIdOf,
  sha512OfFile,
  signedMessage,
} from "../src/main/updateSignature.ts";

// pnpm passes the "--" separator through to the script, so drop it.
const args = process.argv.slice(2).filter((arg) => arg !== "--");
/** Value of a `--flag value` pair, and the indexes it uses. */
function flag(name) {
  const i = args.indexOf(name);
  return { value: i >= 0 ? args[i + 1] : undefined, used: [i, i + 1] };
}
const keyFlag = args.indexOf("--key");
const versionFlag = flag("--version");
const version = versionFlag.value;
const keyPath = keyFlag >= 0 ? args[keyFlag + 1] : undefined;
const files = args.filter(
  (_, i) => i !== keyFlag && i !== keyFlag + 1 && !versionFlag.used.includes(i),
);
if (!keyPath || !version || files.length === 0) {
  console.error(
    "Usage: node scripts/sign-update.mjs --version <version> --key <private-key.pem> <file>...",
  );
  process.exit(1);
}

const privateKey = createPrivateKey(readFileSync(keyPath));
if (privateKey.asymmetricKeyType !== "ed25519") {
  console.error("The key must be an ed25519 private key (see gen-update-key).");
  process.exit(1);
}
const id = keyIdOf(privateKey);
console.log(`Signing with key ${id}`);

for (const file of files) {
  const name = basename(file);
  const message = signedMessage(version, name, await sha512OfFile(file));
  const line = formatSignatureLine(id, sign(null, message, privateKey));
  const sigPath = `${file}.sig`;
  const others = existsSync(sigPath)
    ? readFileSync(sigPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith(id + " "))
    : [];
  writeFileSync(sigPath, [...others, line].join("\n") + "\n");
  console.log(`  ${sigPath}`);
}
