<div align="center">
<h1>AnyTalk</h1>

A chat and voice client for self-hosted <a href="https://stoat.chat">Stoat</a> servers, built with <a href="https://www.solidjs.com/">Solid.js</a>.<br/>
AnyTalk is a personal fork of the Stoat web client (<a href="https://github.com/stoatchat/for-web">stoatchat/for-web</a>).

</div>
<br/>

## What's different from Stoat

AnyTalk keeps Stoat's chat features and adds its own work on top, mostly around calls, mobile and a desktop app:

- **Calls and screen share**: RNNoise noise suppression with a speech gate, stream quality up to 1440p60, fullscreen focused streams, mic and speaker picker in the call footer, automatic reconnect after a network drop, and a developer mode with call stats.
- **Mobile and iPhone**: safe areas, call controls sized for small screens, Safari audio fixes and a loudspeaker/earpiece switch.
- **Desktop app** (Windows and Linux, Electron): global hotkeys, "stream your game" with automatic game detection, an in-game voice overlay, and signed self-updates.
- **Input**: game controller navigation and keyboard support for context menus.
- **Sounds**: message bell, ringtones, notification volumes, vibration on incoming calls.
- **Languages**: maintained translations for German, French, Spanish, Japanese, Korean, Simplified Chinese and Arabic, right-to-left layouts, and language switching without a reload.
- **Deployment**: one Docker image for any Stoat instance, with backend URLs set at container start.

Some call features (stream viewer lists, deafen state) need the patched Stoat API from [anytalk-server](https://github.com/Neparshath-coder/anytalk-server). Against a stock Stoat server they don't work.

## Repository layout

| Path | Contents |
|---|---|
| `packages/client` | The web app (SolidJS, PandaCSS, Vite, Lingui, LiveKit) |
| `packages/desktop` | The Electron desktop app, see [RELEASING.md](packages/desktop/RELEASING.md) |
| `packages/stoat.js` | Stoat API SDK (git submodule) |
| `packages/solid-livekit-components` | Solid bindings for LiveKit (git submodule) |
| `patches/` | pnpm patch for `livekit-client` (runtime screen-share constraints) |
| `docker/`, `Dockerfile` | Container image with runtime config injection |
| `doc/` | mdbook with technical documentation (`mise mdbook`) |

## Development

You need [Git](https://git-scm.com/install/) and [mise-en-place](https://mise.jdx.dev/getting-started.html). mise installs the right Node.js and pnpm versions.

```bash
# clone with submodules
git clone --recursive git@github.com:I-develop-bugs-for-a-living/AnyTalk.git
cd AnyTalk

# after pulling changes to the submodules
# git submodule update --init

# install packages and build the submodule dependencies
mise install:frozen
mise build:deps

# point the client at your Stoat instance
cp packages/client/.env.example packages/client/.env

# start the dev server
mise dev
```

The dev server runs on port 5173 on all network interfaces: http://localhost:5173 on the same machine, or `http://<LAN IP>:5173` from another device. Over plain `http` on a LAN address, browsers block the microphone, camera, screen sharing and the service worker, so test calls on `localhost` or over HTTPS.

`packages/client/assets` is a private submodule with brand assets. Without it, `mise dev` falls back to placeholder assets.

### Configuration

`packages/client/.env` sets the backend:

```env
VITE_API_URL=http://localhost:14702

# optional overrides, otherwise discovered from the API
# VITE_DEV_WS_URL=ws://localhost:14703
# VITE_DEV_MEDIA_URL=http://localhost:14704
# VITE_DEV_PROXY_URL=http://localhost:14705
# VITE_DEV_GIFBOX_URL=http://localhost:14706
```

Without `VITE_API_URL`, the client falls back to the official Stoat backend (see `packages/client/components/common/lib/env.ts`).

### Checks

Run these after a change:

```bash
mise lint          # eslint (mise lint:fix to fix)
mise build:check   # type check
mise test:unit     # vitest
mise format        # prettier (mise format:fix to fix)
```

`mise check` runs everything including the Playwright end-to-end tests. It reinstalls dependencies and takes a while.

Code rules are in [GUIDELINES.md](GUIDELINES.md), UI design rules in [DESIGN.md](packages/client/components/ui/DESIGN.md).

### Translations

All user-facing text goes through Lingui macros. After adding or changing text, regenerate the catalogs with `mise lingui`. Don't edit the files in `packages/client/components/i18n/catalogs` by hand.

## Deployment

### Docker

Pushes to `main` build an image and publish it to GitHub Container Registry:

- `ghcr.io/i-develop-bugs-for-a-living/anytalk:latest` (latest `main`)
- `ghcr.io/i-develop-bugs-for-a-living/anytalk:<commit sha>` (for pinning and rollback)
- `ghcr.io/i-develop-bugs-for-a-living/anytalk:<version>` (for `v*` tags)

The backend URLs aren't baked into the image. Set them as environment variables on the container and they're injected at startup, so one image works for any Stoat instance:

```bash
docker run -p 5000:5000 \
  -e VITE_API_URL=https://chat.example.com/api \
  -e VITE_HOST=chat.example.com \
  ghcr.io/i-develop-bugs-for-a-living/anytalk:latest
```

Also supported: `VITE_DEV_WS_URL`, `VITE_DEV_MEDIA_URL`, `VITE_DEV_PROXY_URL`, `VITE_DEV_GIFBOX_URL`, and `VITE_DESKTOP_RELEASES_REPO` (the GitHub repo whose releases the "Desktop app" settings page lists).

### Static build

```bash
mise install:frozen
mise build:deps
mise build
```

Then serve `packages/client/dist`. It's a single-page app, so the server has to answer every app route with `index.html`: `/login`, `/pwa`, `/dev`, `/discover`, `/settings`, `/invite`, `/bot`, `/friends`, `/server` and `/channel` (defined in `packages/client/src/index.tsx`).

### Desktop app

```bash
mise desktop:dev         # run against the configured server
mise desktop:build       # Linux packages
mise desktop:build:win   # Windows installer
```

The desktop app loads a hosted AnyTalk server instead of bundling the client. Releases are tagged `desktop-v<version>`; CI builds them and publishes them to GitHub Releases. Installers must be signed before the app accepts them as updates, see [packages/desktop/RELEASING.md](packages/desktop/RELEASING.md).

## License

AnyTalk is licensed under the [GNU Affero General Public License v3.0](LICENSE), like Stoat, which it's based on.
