# Releasing AnyTalk Desktop

## How updates are trusted

The GitHub release is not trusted on its own. Every installer (`.exe` for
Windows, `.AppImage` for Linux) needs a `<installer>.sig` file next to it in the
release, signed with the ed25519 private key of a releaser. The app embeds the
public keys of all releasers (`src/main/trustedUpdateKeys.ts`) and installs an
update only if its `.sig` holds a valid signature from at least one of them.

The check runs in the app (`src/main/updater.ts`) on the finished download,
before anything can be installed (also install-on-quit stays off until then).
It fails closed: no `.sig`, a bad signature, an unreachable `.sig` or an empty
key list means the file is deleted and the app shows the normal "update
failed" state. The logic lives in `src/main/updateSignature.ts`
(`pnpm --filter anytalk-desktop run test`).

A `.sig` file has one line per signer: `<key id> <base64 signature>`. The
signature covers the version, the file name and the SHA-512 of the content, so an older signed installer can't be offered as a newer version through the unsigned `latest*.yml`. The app also requires the file name to contain the version.

Private keys never go into the repo, GitHub secrets or CI.

## One-time: create your key

```bash
cd packages/desktop
pnpm run gen-update-key -- --owner "Your Name <you@example.com>"
```

This writes the private key to `~/.config/anytalk-release/update-key.pem`
(mode 600; pass a path as the first argument to use another one, it refuses
paths inside the repo or an existing file). Back it up. It prints an entry for
`TRUSTED_UPDATE_KEYS`; paste it into `src/main/trustedUpdateKeys.ts`
(or send it to the person who keeps that file). The key only counts for
versions released after it was added.

## Requirements

Node 22.18 or newer (the scripts import the TypeScript verification module
directly) and the GitHub CLI `gh`, logged in. Run the scripts through `pnpm run`
in `packages/desktop` (it silences a harmless Node module-type warning).

## Releasing

1. Bump `version` in `packages/desktop/package.json`, commit, push, and push
   the tag `desktop-v<version>`.
2. CI builds and publishes the release (installers, `latest*.yml`) as before.
   Installed apps that already verify will refuse it until step 3 is done, and
   retry every 4 hours (or at the next start).
3. Sign it on your machine:

   ```bash
   cd packages/desktop
   pnpm run sign-release <version> --key ~/.config/anytalk-release/update-key.pem
   ```

   It downloads the installers with `gh` (logged in, write access), shows their
   SHA-512, aborts if they differ from `latest*.yml`, asks
   for confirmation, signs, and uploads the `.sig` files with
   `gh release upload`. If other releasers sign too, each run adds a line to
   the same `.sig` (any one valid line is enough, one is all that's needed).

   To do the steps by hand: download the installers, then
   `pnpm run sign-update --version <version> --key <key.pem> <installer>...` and
   `gh release upload desktop-v<version> <installer>.sig...`.

The workflow publishes the release immediately (it is not a draft), because
electron-builder's own publishing and a draft release don't mix reliably.
Clients fail closed, so nobody installs the unsigned release in between.

## Adding or removing a releaser

- Add: they run `gen-update-key`, send you the printed entry, you add it to
  `trustedUpdateKeys.ts` and ship a new version. Older versions don't know the
  key and won't accept their signatures until users update (signed by someone
  already trusted).
- Remove (e.g. a lost key): delete the entry and ship a new version, signed by
  someone else. Installed older versions keep trusting the removed key until
  they update, so ship the removal soon.

## Rollout note

Versions up to and including 0.3.1 don't verify anything. The first version
with this check (0.3.2 or later) is released as usual and is installed by 0.3.1
without verification; from then on updates are verified. The release workflow fails on a `desktop-v*` tag if `TRUSTED_UPDATE_KEYS` is
empty, so a release that could never update itself is not published.
