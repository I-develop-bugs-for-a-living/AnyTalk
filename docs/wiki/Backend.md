# Backend

AnyTalk runs on a regular [Stoat](https://github.com/stoatchat/stoatchat) backend with one service replaced: the **api** (`delta`). The patched api comes from a separate repository, [anytalk-server](https://github.com/Neparshath-coder/anytalk-server). Every other backend service (events, file server, proxy, gifbox, crond, pushd, voice-ingress, LiveKit) uses the official Stoat images unchanged.

## Why a patched api is needed

The api creates the LiveKit tokens people use to join a call, and it updates their call permissions while the call runs. Stock Stoat leaves out two permissions that AnyTalk features need:

| Feature | What the client does | Needs |
|---|---|---|
| Stream viewers ("who's watching") | Sends LiveKit data messages on the topic `anytalk:watching` | `canPublishData` |
| Deafen indicator (headset icon next to deafened people) | Sets its own participant attribute `deafened` | `canUpdateOwnMetadata` |

Against a stock Stoat server, the call itself still works. The server rejects these two actions, so the viewer list stays empty and nobody sees who is deafened. The browser console shows permission errors such as *"does not have permission to update own metadata"*.

## What the patches change

The repository doesn't contain Stoat's source code. It holds patch files that the build applies to a fresh copy of upstream Stoat.

### 0001: data messages and own attributes

- `crates/core/database/src/voice/voice_client.rs`, `create_token` (the join token): `can_publish_data` goes from `false` to `true`, and `can_update_own_metadata: true` is added.
- `crates/core/database/src/voice/mod.rs`, `sync_user_voice_permissions` (the permission re-sync during a call): `can_publish_data` is always `true` (upstream tied it to the Speak permission), and `can_update_metadata: true` is added. Without this part, the first mid-call permission change, such as a role edit, would take the rights away again.

Every participant gets both rights, including people who can only listen. Someone with a modified client could therefore change the call info shown for themselves. For a server among friends, that's an acceptable trade-off.

### 0002: permission re-sync and moderation fixes (security)

- `sync_user_voice_permissions` now sends the list of allowed sources (microphone, camera, screen share, screen share audio), built with the same `get_allowed_sources` check as the join token, and `can_publish` is only true when that list isn't empty. Before the fix, LiveKit read an empty list as "all sources". After any role edit during a call, a member without the Video permission could then share their camera or screen.
- `crates/delta/src/routes/servers/member_edit.rs`: after a moderator server-muted or server-deafened someone, the re-sync ran for the moderator instead of the edited member, so the change never reached that member's call. It now targets the edited member. Likewise, "disconnect from voice" disconnected the moderator. It now disconnects the member.

### Not patched

- "Call started" system messages are created by the `voice-ingress` daemon. Patching it would need a second custom image, so the AnyTalk client marks these messages as read on its own.
- Everything else on the backend is stock Stoat.

## Images

Built by GitHub Actions in the anytalk-server repository:

| Image | Purpose |
|---|---|
| `ghcr.io/neparshath-coder/anytalk-server-api:<stoat version>-anytalk` | The patched api. Deploy this one. |
| `ghcr.io/neparshath-coder/anytalk-server-api:latest` | Newest build |
| `ghcr.io/neparshath-coder/anytalk-server-base:<stoat version>-anytalk` | Build intermediate, not deployed |

- Only `linux/amd64` is built. To get arm64, add `linux/arm64` to the platforms in both build steps of the workflow. Use an arm runner (`ubuntu-24.04-arm`): emulating arm64 with QEMU takes hours.
- The image owner is taken from the repository's owner. If the repository moves to another GitHub account, the image name changes with it.
- Images built so far: `v0.15.7-anytalk`.

> **Keep versions in sync.** The patched api must run the same Stoat version as all other Stoat services. `anytalk-server-api:v0.15.7-anytalk` goes with `ghcr.io/stoatchat/events:v0.15.7`, `file-server:v0.15.7` and so on. Mixing versions risks API and database mismatches.

## How the build works

Workflow: `.github/workflows/build.yml` ("Build patched Stoat server").

**Triggers**
- Every day by schedule. If Stoat published a new release, the workflow builds `<new version>-anytalk` automatically.
- By hand (`workflow_dispatch`), with two inputs:
  - `version`: a Stoat tag such as `v0.15.7`. Empty means the latest release.
  - `force`: rebuild even if the image already exists.
- On pushes to `main` that change `patches/**` or the workflow itself.

Scheduled runs, and manual runs without `force`, skip the build if the image tag already exists. Those runs take only a few minutes. A full build takes about 35 minutes.

**Steps**
1. Clone `stoatchat/stoatchat` at the chosen tag.
2. Apply every `patches/*.patch` in order. The job fails if one doesn't apply.
3. Build the base image, which compiles the whole Rust workspace, with `CARGO_BUILD_JOBS=3` (higher values run the runner out of memory).
4. Point `crates/delta/Dockerfile` at that base image (upstream hardcodes `ghcr.io/stoatchat/base:latest`).
5. Build and push the api image.

New GHCR packages start private. After the first build, set the `anytalk-server-api` package to public in its package settings, so servers can pull it without logging in.

## Updating to a new Stoat release

1. Wait for the daily build to produce `<new version>-anytalk`, or start it by hand.
2. If the build fails, a patch most likely no longer applies to the new Stoat code. Regenerate it (see [Changing the patches](#changing-the-patches)) and push it to `main`.
3. On the server, update the api to the new `-anytalk` image **and** every other Stoat service to the same version in one go. See [Self-Hosting](Self-Hosting#updating).

## Changing the patches

1. Clone upstream Stoat at the version you deploy, and apply the existing patches.
2. Make the change.
3. From the upstream root, write it out as a new numbered patch: `git diff > patches/0003-short-name.patch`. Keep one patch per logical change.
4. Check that it applies to the deployed version and to the latest release: `git apply --check`.
5. Check that it compiles: `cargo check -p revolt-database`, or `cargo check -p revolt-delta` if it touches `crates/delta`.
6. Update the "What the patch changes" section of the anytalk-server README, and this page.

Useful places in upstream Stoat:

| What | Where |
|---|---|
| LiveKit token grants | `crates/core/database/src/voice/voice_client.rs` (`create_token`) |
| Permission re-sync during calls | `crates/core/database/src/voice/mod.rs` (`sync_user_voice_permissions`) |
| "Call started" messages | `crates/daemons/voice-ingress/src/api.rs` |
| Image build | root `Dockerfile` plus `crates/delta/Dockerfile` |

## Checking that the patch is active

- **In a call:** two people join a voice channel on desktop. One deafens, and the other should see a headset icon next to them. One shares their screen, and when the other opens the stream, they should show up as watching.
- **Image tag:** the running api container's image should end in `-anytalk`.
- **Join token:** decode the LiveKit token the client receives when joining (it's a JWT). With the patch, its `video` grant contains `canPublishData: true` and `canUpdateOwnMetadata: true`. Stock Stoat sends `canPublishData: false`.
