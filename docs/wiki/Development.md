# Development

How the code is organised and how to work on it. Setup steps are also in the [README](https://github.com/I-develop-bugs-for-a-living/AnyTalk#development).

## Stack

| Part | Technology |
|---|---|
| UI | [SolidJS](https://www.solidjs.com/) 1.9.14 (pinned: newer versions break reactivity) |
| Styling | [PandaCSS](https://panda-css.com/), Material 3-based components |
| Build | Vite, pnpm workspace, tasks through [mise](https://mise.jdx.dev/) |
| Calls | [LiveKit](https://livekit.io/) (`livekit-client`, patched) |
| API | `stoat.js` SDK |
| Translations | [Lingui](https://lingui.dev/) |
| Tests | Vitest (unit), Playwright (end-to-end) |
| Desktop | Electron, electron-builder |

## Repository layout

| Path | Contents |
|---|---|
| `packages/client` | The web app |
| `packages/desktop` | The desktop app |
| `packages/stoat.js` | API and websocket SDK (git submodule, upstream code) |
| `packages/solid-livekit-components` | Solid bindings for LiveKit (git submodule) |
| `packages/client/assets` | Brand assets (private submodule; placeholders are used without it) |
| `patches/livekit-client.patch` | Adds screen-share constraints that can change while sharing |
| `Dockerfile`, `docker/` | Web app image with runtime config injection |
| `doc/` | mdbook with technical documentation, mostly from upstream Stoat |

### Inside `packages/client`

| Path | Contents |
|---|---|
| `src/` | Entry point, router and app shell: sidebars, home, friends, discover, channel page frame |
| `components/app` | Larger screens: message list, settings, context menus |
| `components/rtc` | Calls: room lifecycle, mic pipeline (RNNoise), screen capture, reconnect, stream viewers, overlay data |
| `components/ui` | Shared UI components, themes, messaging and voice UI |
| `components/state/stores` | Persisted client state (settings, voice, layout, drafts ...) |
| `components/modal` | Dialogs |
| `components/i18n` | Lingui setup and generated catalogs |
| `components/gamepad` | Controller navigation |
| `components/keybinds` | Keyboard shortcuts |
| `components/markdown` | Message rendering (unified, remark, rehype) |

Components are imported through `@revolt/*` aliases (`@revolt/ui`, `@revolt/rtc`, `@revolt/state` ...), defined in `packages/client/tsconfig.json`.

### How a call works

1. Joining a voice channel picks a LiveKit node and calls `channel.joinCall()` in stoat.js. The api returns the LiveKit URL and a token.
2. The client creates a LiveKit `Room` with the settings from the `Voice` store. Room events update the call state, and the UI reads it through `useVoice()`.
3. The microphone runs through `VoiceProcessor.ts`: high-pass filter, optional RNNoise, compressor, gain.
4. Screen shares are only subscribed while someone watches them. Viewers announce this through LiveKit data messages (`anytalk:watching`), which needs the [patched backend](Backend).

## Setup

You need Git and [mise](https://mise.jdx.dev/getting-started.html). mise installs Node.js, pnpm and the other tools in the pinned versions.

```bash
git clone --recursive git@github.com:I-develop-bugs-for-a-living/AnyTalk.git
cd AnyTalk
mise install:frozen
mise build:deps
cp packages/client/.env.example packages/client/.env   # set VITE_API_URL
mise dev
```

The dev server runs on port 5173 on all network interfaces. To test on a phone, open `http://<computer's LAN IP>:5173`, and allow the port in the firewall if needed. Over plain `http`, the phone browser blocks the microphone, camera, screen sharing and the service worker, so calls need an HTTPS setup.

For a local backend, run the [Stoat stack](Self-Hosting) on your machine and point `VITE_API_URL` at it.

## Tasks

| Task | What it does |
|---|---|
| `mise dev` | Dev server |
| `mise build` | Production build to `packages/client/dist` |
| `mise build:deps` | Build the submodules (stoat.js, solid-livekit-components). Run again after they change. |
| `mise lint` / `lint:fix` | ESLint |
| `mise build:check` | TypeScript type check |
| `mise test:unit` | Vitest |
| `mise test:e2e` | Playwright |
| `mise format` / `format:fix` | Prettier |
| `mise check` | Everything CI runs, including a fresh install and the end-to-end tests. Slow. |
| `mise lingui` | Extract and compile translations |
| `mise mdbook` | Serve the docs in `doc/` |
| `mise desktop:dev` | Run the desktop app against the dev server |
| `mise desktop:build` | Linux packages (AppImage, deb, rpm, pacman) |
| `mise desktop:build:win` | Windows installer, cross-built without Wine |
| `mise desktop:build:win:zip` | Portable Windows zip |
| `mise desktop:typecheck` | Type check the desktop app |

After a change, run `mise lint`, `mise build:check`, `mise test:unit` and `mise format`. There are few unit tests, so the linter and type check catch most mistakes. Add a `*.test.ts` next to new pure logic.

## Code rules

The full rules are in [GUIDELINES.md](https://github.com/I-develop-bugs-for-a-living/AnyTalk/blob/main/GUIDELINES.md), UI design in [DESIGN.md](https://github.com/I-develop-bugs-for-a-living/AnyTalk/blob/main/packages/client/components/ui/DESIGN.md). The most important:

- Never destructure Solid props: it breaks reactivity. Use `props.x` or `splitProps`.
- A doc comment above every component, function, class and constant.
- Semantic HTML, aria labels, keyboard and screen reader support.
- Import an external library in one place and re-export it.
- All user-facing text in Lingui macros: `<Trans>` in JSX, `t` from `useLingui()` in code.

## Translations

1. Wrap new text in Lingui macros.
2. Run `mise lingui` to extract it into the catalogs in `packages/client/components/i18n/catalogs`. Don't edit them by hand.
3. Fill in the translations. `node scripts/po-untranslated.mjs` (in `packages/client`) lists missing strings and checks placeholders, tags and plurals.
4. The joke languages (`bottom`, `enchantment`, `leet`, `piglatin`) are generated: run `node scripts/po-encode.mjs` after extracting.

Commit catalog changes separately (`chore: extract i18n catalogs`).

## Branches and releases

| Branch | Purpose |
|---|---|
| `Development` | Working branch |
| `main` | Release branch. Every push builds and publishes the Docker image. |

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), describing the change from the user's point of view: `fix: call tiles no longer flicker after closing a focused stream`. [git-town](https://www.git-town.com/) is configured for branch syncing.

### Web app

Pushing to `main` builds `ghcr.io/i-develop-bugs-for-a-living/anytalk:latest` and a tag per commit (`.github/workflows/docker.yml`). Pushing a `v<version>` tag adds a version tag.

### Desktop app

1. Bump `version` in `packages/desktop/package.json` and push.
2. Push the tag `desktop-v<version>`. CI builds the installers and publishes the GitHub release.
3. Sign the installers on your own machine:
   ```bash
   cd packages/desktop
   pnpm run sign-release <version> --key ~/.config/anytalk-release/update-key.pem
   ```
   This downloads the installers, checks them against the release metadata, signs them and uploads the `.sig` files. Until then, installed apps refuse the update.

Releasers create their key once with `pnpm run gen-update-key -- --owner "Name <mail>"`. Private keys never go into the repository or CI. The trusted public keys are in `packages/desktop/src/main/trustedUpdateKeys.ts`, so adding a releaser needs a new app version. Details: [RELEASING.md](https://github.com/I-develop-bugs-for-a-living/AnyTalk/blob/main/packages/desktop/RELEASING.md).

The default server is set at build time with the `ANYTALK_DEFAULT_URL` repository variable.

### Backend

The patched api is built in a separate repository. See [Backend](Backend).
