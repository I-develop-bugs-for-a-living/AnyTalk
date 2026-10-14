# Configuration

Settings for server owners. For the full setup, see [Self-Hosting](Self-Hosting).

## Web app

The AnyTalk Docker image (`ghcr.io/i-develop-bugs-for-a-living/anytalk`) is built without any server URLs. They're set as environment variables and written into the app when the container starts, so one image works for any server. After changing them, restart the container.

| Variable | Required | Example | Meaning |
|---|---|---|---|
| `VITE_HOST` | yes | `chat.example.com` | Your domain, without `https://` |
| `VITE_API_URL` | yes | `https://chat.example.com/api` | The Stoat API |
| `VITE_DEV_GIFBOX_URL` | recommended | `https://chat.example.com/gifbox` | GIF search. Without it, the app uses `api.gifbox.me`. |
| `VITE_DEV_WS_URL` | no | `wss://chat.example.com/ws` | Websocket |
| `VITE_DEV_MEDIA_URL` | no | `https://chat.example.com/autumn` | File server |
| `VITE_DEV_PROXY_URL` | no | `https://chat.example.com/january` | Link preview and image proxy |
| `VITE_DESKTOP_RELEASES_REPO` | no | `I-develop-bugs-for-a-living/AnyTalk` | GitHub repository whose `desktop-v*` releases the "Desktop app" page lists |

You usually don't need the websocket, file server and proxy variables: the app reads those URLs from the API (`GET /api`), which takes them from `[hosts]` in `Revolt.toml`.

The container serves the app on port **5000**. In the Stoat stack, Caddy forwards to `web:5000`, so no port needs to be published.

### Image tags

| Tag | Meaning |
|---|---|
| `latest` | Newest build of the `main` branch |
| `<commit>` | A specific commit, for pinning and rollback |
| `<version>`, e.g. `0.3.0` | A tagged release |

## Server (`Revolt.toml`)

The settings that matter most for AnyTalk. Stoat's [Revolt.toml reference](https://github.com/stoatchat/stoatchat/blob/main/crates/core/config/Revolt.toml) lists all of them.

### Public URLs

```toml
[hosts]
app = "https://chat.example.com"
api = "https://chat.example.com/api"
events = "wss://chat.example.com/ws"
autumn = "https://chat.example.com/autumn"
january = "https://chat.example.com/january"
gifbox = "https://chat.example.com/gifbox"

[hosts.livekit]
worldwide = "wss://chat.example.com/livekit"

[api.livekit.nodes.worldwide]
url = "http://livekit:7880"
lat = 0.0
lon = 0.0
```

`generate_config.sh` writes all of this. Every file has to use the same domain: `Revolt.toml`, `.env.web` and `stoat.json`.

### Stream resolution

Stoat **kicks anyone from a call who sends video larger than `video_resolution`**. The generated config allows 1080p. AnyTalk offers up to 1440p, and "Source" sends your screen's native size. Set the limit to the largest size people should stream, in **both** sections:

```toml
[features.limits.default]
video_resolution = [2560, 1440]
video_aspect_ratio = [0.3, 10]

[features.limits.new_user]
video_resolution = [2560, 1440]
video_aspect_ratio = [0.3, 10]
```

For 4K screens with "Source" quality, use `[3840, 2160]` or higher.

AnyTalk's quality picker only offers what the limit allows.

### Registration

```toml
[api.registration]
invite_only = true
```

Create invite codes in MongoDB:

```bash
docker compose exec database mongosh revolt --eval 'db.account_invites.insertOne({ _id: "mycode" })'
```

### GIF search

Add a gifbox.me API key to `secrets.env`, then restart `gifbox`:

```env
REVOLT__API__SECURITY__TENOR_KEY=<key>
```

## LiveKit (`livekit.yml`)

LiveKit carries the call audio and video. The generated file:

```yaml
rtc:
  use_external_ip: true
  port_range_start: 50000
  port_range_end: 50100
  tcp_port: 7881

redis:
  address: redis:6379

turn:
  enabled: false

keys:
  <key>: <secret>

webhook:
  api_key: <key>
  urls:
  - "http://voice-ingress:8500/worldwide"
```

| Setting | Notes |
|---|---|
| `use_external_ip` | LiveKit looks up its public IP and gives it to clients. The server needs a public IP or port forwarding. |
| `port_range_start` / `_end` | UDP ports for media. Must match the `ports:` of the `livekit` service in `compose.yml` and the firewall. |
| `tcp_port` | Fallback for networks that block UDP. Must be open too. |
| `keys`, `webhook.api_key` | Must match the LiveKit key and secret in `secrets.env`. |
| `turn` | Off by default. A TURN server helps people behind strict firewalls, but needs extra ports. |

> YAML is strict about indentation. A single stray space makes LiveKit crash on start, and calls fail with a 502 on `/livekit`. The error message often points at the line *before* the mistake. See [Troubleshooting](Troubleshooting#calls-fail-to-connect).

## Desktop app

| Variable | When | Meaning |
|---|---|---|
| `ANYTALK_DEFAULT_URL` | Build time | The server the app opens by default. Set as a repository variable for the desktop workflow. |
| `ANYTALK_URL` | Run time | Overrides the server, e.g. for testing: `ANYTALK_URL=https://chat.example.com ./AnyTalk.AppImage` |

See [Desktop App](Desktop-App#choosing-the-server).
