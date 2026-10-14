// Creates an ed25519 key pair for signing AnyTalk Desktop updates.
//
//   node scripts/gen-update-key.mjs [private-key-path] [--owner "Name <email>"]
//
// The private key is written to the given path (default
// ~/.config/anytalk-release/update-key.pem, mode 600) and must stay outside
// the repository. The public key entry is printed: send it to whoever
// maintains src/main/trustedUpdateKeys.ts. Refuses to overwrite a key.
import { generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { keyIdOf } from "../src/main/updateSignature.ts";

const args = process.argv.slice(2);
let owner = "Your Name <you@example.com>";
let target = resolve(homedir(), ".config/anytalk-release/update-key.pem");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--owner") owner = args[++i] ?? owner;
  else target = resolve(args[i].replace(/^~(?=$|\/)/, homedir()));
}

/** realpath of a directory that may not exist yet: resolves its nearest existing ancestor. */
function realExistingPath(dir) {
  const rest = [];
  let current = dir;
  while (!existsSync(current)) {
    rest.unshift(basename(current));
    current = dirname(current);
  }
  return join(realpathSync(current), ...rest);
}

// Keep the private key out of the repo, it would end up in a commit. Resolve
// symlinks of the parent directory and compare with path.relative so it works
// with backslashes and links alike.
const repoRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
);
const fromRepo = relative(
  repoRoot,
  join(realExistingPath(dirname(target)), basename(target)),
);
if (!fromRepo.startsWith("..") && !isAbsolute(fromRepo)) {
  console.error(`Refusing to write the private key inside the repo: ${target}`);
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`${target} already exists, not overwriting it.`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync(target, privateKey.export({ type: "pkcs8", format: "pem" }), {
  mode: 0o600,
});
chmodSync(target, 0o600);

const pem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
console.log(`Private key written to ${target} (keep it secret, back it up).`);
console.log(`Key id: ${keyIdOf(publicKey)}\n`);
console.log(
  "Add this entry to TRUSTED_UPDATE_KEYS in src/main/trustedUpdateKeys.ts:\n",
);
console.log("  {");
console.log(`    owner: ${JSON.stringify(owner)},`);
console.log("    publicKey: `" + pem + "`,");
console.log("  },");
