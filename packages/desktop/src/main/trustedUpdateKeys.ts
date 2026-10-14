import type { TrustedKey } from "./updateSignature";

/**
 * Public ed25519 keys of the people allowed to release AnyTalk Desktop. The
 * app installs an update only if its `.sig` file holds a valid signature from
 * at least ONE of these keys. An empty list means no update is ever installed.
 *
 * To add a releaser: they run `node scripts/gen-update-key.mjs` and send you
 * the printed entry; paste it below and ship a new version. To remove one,
 * delete the entry and ship a new version (see RELEASING.md). Only public keys
 * belong here, never a private key.
 */
export const TRUSTED_UPDATE_KEYS: readonly TrustedKey[] = [
  {
    owner: "Neparshath",
    publicKey: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAl8oQ0mclTQMhChpWKtAbndQ9ci0TP+FVciAWh8CikD4=
-----END PUBLIC KEY-----`,
  },
];
