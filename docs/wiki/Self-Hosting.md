# Self-Hosting an AnyTalk Server

An AnyTalk server is the official [Stoat self-hosted stack](https://github.com/stoatchat/self-hosted) with two images swapped:

| Service | Stoat image | AnyTalk image |
|---|---|---|
| `web` (the web app) | `ghcr.io/stoatchat/for-web` | `ghcr.io/i-develop-bugs-for-a-living/anytalk` |
| `api` (REST API) | `ghcr.io/stoatchat/api` | `ghcr.io/neparshath-coder/anytalk-server-api:<version>-anytalk` |

Everything else (database, file storage, websocket server, LiveKit for calls, Caddy as reverse proxy) is Stoat's standard setup. This guide walks through a fresh install. If you already run Stoat, skip to [Switch an existing Stoat server to AnyTalk](#switch-an-existing-stoat-server-to-anytalk).

## Requirements

- **A Linux server** with at least 2 CPU cores and 2 GB of RAM. Stoat tests on Ubuntu Server.
- **x86-64 (amd64).** The patched api image is only built for amd64. For arm64 see [Backend](Backend#images).
- **A domain or subdomain**, for example `chat.example.com`, with an A record (and AAAA for IPv6) pointing to the server. Everything runs under this one domain.
- **A public IP, or port forwarding on your router**, for these ports:

| Port | Protocol | Used for |
|---|---|---|
| 80 | TCP | HTTP, Let's Encrypt certificate |
| 443 | TCP | HTTPS: app, API, websocket, LiveKit signalling |
| 7881 | TCP | LiveKit call media over TCP (fallback when UDP is blocked) |
| 50000–50100 | UDP | LiveKit call media |

Ports 7881 and 50000–50100 don't go through Caddy. They have to be reachable directly, or calls connect but nobody hears anything.

- **Docker Engine** with the Compose plugin, plus `git`, `curl` and `openssl`.

## 1. Prepare the server

```bash
sudo apt-get update && sudo apt-get upgrade -y

# firewall
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw allow 7881/tcp
sudo ufw allow 50000:50100/udp
sudo ufw enable
```

Install Docker by following [Docker's guide for your distribution](https://docs.docker.com/engine/install/).

> Docker publishes container ports past ufw. The firewall doesn't protect ports that a container publishes, so only publish the ports listed above.

## 2. Get the Stoat stack and generate the config

```bash
git clone https://github.com/stoatchat/self-hosted anytalk
cd anytalk
chmod +x ./generate_config.sh
./generate_config.sh chat.example.com
```

The script asks two questions:

1. **"Place Stoat behind another reverse proxy?"** Answer **No** unless the server already runs a reverse proxy (Traefik, nginx, Coolify ...). With No, the stack's Caddy handles HTTPS itself. With Yes, Caddy listens on plain HTTP on port 8880 and your own proxy has to forward to it, including websocket upgrades for `/ws` and `/livekit`.
2. **"Enable camera and screen sharing?"** Answer **Yes**. AnyTalk's calls depend on it.

It generates these files:

| File | Contents |
|---|---|
| `Revolt.toml` | Server config: public URLs, LiveKit node, video limits |
| `livekit.yml` | LiveKit config: ports, Redis, API key, webhook |
| `secrets.env` | Generated keys: file encryption, push notifications, LiveKit |
| `.env.web` | Settings for Caddy and the web app (`VITE_HOST`, `VITE_API_URL`, `VITE_DEV_GIFBOX_URL`) |
| `.env` | `STOAT_DOMAIN` |
| `stoat.json` | Served at `/.well-known/stoat`, points clients at the API |

> **Back up `secrets.env` now.** It holds the key that encrypts uploaded files. Without it, every uploaded file is lost.

## 3. Swap in the AnyTalk images

Don't edit `compose.yml` itself: `git pull` would conflict with your changes when you update. Put the changes in `compose.override.yml` instead (git ignores it):

```yaml
# compose.override.yml
services:
  web:
    image: ghcr.io/i-develop-bugs-for-a-living/anytalk:latest

  api:
    image: ghcr.io/neparshath-coder/anytalk-server-api:v0.15.7-anytalk

  # all other Stoat services on the same version as the api
  events:
    image: ghcr.io/stoatchat/events:v0.15.7
  autumn:
    image: ghcr.io/stoatchat/file-server:v0.15.7
  january:
    image: ghcr.io/stoatchat/proxy:v0.15.7
  gifbox:
    image: ghcr.io/stoatchat/gifbox:v0.15.7
  crond:
    image: ghcr.io/stoatchat/crond:v0.15.7
  pushd:
    image: ghcr.io/stoatchat/pushd:v0.15.7
  voice-ingress:
    image: ghcr.io/stoatchat/voice-ingress:v0.15.7
```

If you answered Yes to the reverse proxy question, `compose.override.yml` already exists. Add these entries to it instead of replacing it.

**Versions:**

- The api tag is the Stoat version plus `-anytalk`. All other Stoat services must run exactly that Stoat version. Check which `-anytalk` versions exist on the [package page](https://github.com/Neparshath-coder/anytalk-server/pkgs/container/anytalk-server-api).
- For the web app, `latest` follows AnyTalk's `main` branch. To control when the app changes, pin a release tag (such as `0.3.0`) or a commit tag instead.

The web app needs no extra settings. It reads `.env.web`, which `generate_config.sh` already filled in:

```env
VITE_HOST=chat.example.com
VITE_API_URL=https://chat.example.com/api
VITE_DEV_GIFBOX_URL=https://chat.example.com/gifbox
```

The other URLs (websocket, files, proxy) are taken from the API. For all supported variables, see [Configuration](Configuration#web-app).

## 4. Allow higher stream quality (optional)

AnyTalk can share screens at up to 1440p. The generated config allows 1080p, and **Stoat kicks anyone from a call who streams above the limit.** To allow 1440p, change both sections in `Revolt.toml`:

```toml
[features.limits.default]
video_resolution = [2560, 1440]
video_aspect_ratio = [0.3, 10]

[features.limits.new_user]
video_resolution = [2560, 1440]
video_aspect_ratio = [0.3, 10]
```

## 5. Start it

Run it in the foreground the first time, so you can watch for errors:

```bash
docker compose pull
docker compose up
```

When everything is running, stop it with Ctrl+C and start it in the background:

```bash
docker compose up -d
```

`createbuckets` shows as *Exited*. That's normal: it only creates the storage bucket once.

## 6. Check that it works

```bash
# API: JSON with the version and the URLs of ws, autumn, january, livekit
curl -s https://chat.example.com/api

# LiveKit: should print "OK" and 200
curl -s -w '\n%{http_code}\n' https://chat.example.com/livekit
```

Then open `https://chat.example.com`, create an account and a server, and test a call with two people on different networks. Check:

- both hear each other;
- screen sharing works, and the viewer shows up as watching for the streamer;
- when someone deafens, the others see a headset icon next to them.

The last two only work with the patched api. See [Backend](Backend#checking-that-the-patch-is-active).

## Optional settings

| What | How |
|---|---|
| **Invite-only registration** | In `Revolt.toml`: `[api.registration]` `invite_only = true`. Create invite codes in MongoDB: `docker compose exec database mongosh revolt --eval 'db.account_invites.insertOne({ _id: "mycode" })'` |
| **GIF picker** | Add `REVOLT__API__SECURITY__TENOR_KEY=<key>` (a gifbox.me API key) to `secrets.env` and restart `gifbox` |
| **Email verification, captcha, S3 storage, push notifications** | See Stoat's [Revolt.toml reference](https://github.com/stoatchat/stoatchat/blob/main/crates/core/config/Revolt.toml) |
| **Desktop download page** | Set `VITE_DESKTOP_RELEASES_REPO` in `.env.web` if your desktop builds come from a different GitHub repository |

After changing `Revolt.toml` or `secrets.env`, restart the stack with `docker compose up -d --force-recreate`. After changing `.env.web`, restart `web`: its values are injected when the container starts.

## Switch an existing Stoat server to AnyTalk

1. Pick a time when nobody is in a call. The restart disconnects everyone for up to a minute.
2. Back up the database:
   ```bash
   docker compose exec database mongodump --archive=/data/db/backup-before-anytalk.gz --gzip
   ```
3. Save a copy of your current compose files.
4. Change the images as in [step 3](#3-swap-in-the-anytalk-images). If your Stoat services run an older version than the newest `-anytalk` api, update all of them to that version in the same step.
5. Optionally raise the video limit ([step 4](#4-allow-higher-stream-quality-optional)).
6. `docker compose pull && docker compose up -d`, then [check it](#6-check-that-it-works).

**Rolling back:**

- If only the api misbehaves, set it back to the official `ghcr.io/stoatchat/api:<same version>`.
- If the whole server breaks, restore the saved compose files. If the database was already migrated to the new version, restore the backup:
  ```bash
  docker compose exec database mongorestore --archive=/data/db/backup-before-anytalk.gz --gzip --drop
  ```

### Coolify and other panels

The same images and versions apply. Some details for Coolify:

- Coolify keeps a separate copy of `Revolt.toml` for each service that mounts it. After editing it in one service, paste the same content into all the others.
- Use the plain **Restart**, not **Restart (pull latest)**: pulling updates every unpinned image, including MongoDB (see [Pin MongoDB](#pin-mongodb)).
- If Coolify's own proxy (Traefik) sits in front, answer Yes to the reverse proxy question, or point Traefik at the stack's Caddy.

## Updating

1. Check that an `-anytalk` api image exists for the Stoat version you want.
2. Back up (see below).
3. `git pull` in the stack folder, and read the notices in Stoat's self-hosted README.
4. Update the versions in `compose.override.yml`: every Stoat service to the new version, the api to `<new version>-anytalk`, the web app to the release you want.
5. `docker compose pull && docker compose up -d`.

`./generate_config.sh --overwrite chat.example.com` regenerates the config with new options, but replaces `Revolt.toml`, `livekit.yml` and `.env.web` (the old files are kept as `*.old`). Reapply your own changes afterwards, such as the video limit.

### Pin MongoDB

`compose.yml` uses `docker.io/mongo:8`, which moves to newer releases when pulled. Pin an exact version in `compose.override.yml` so an update can't change the database unexpectedly:

```yaml
  database:
    image: docker.io/mongo:8.0
```

On old CPUs without AVX, MongoDB 5+ doesn't start. Use `mongo:4.4` and change the health check to use `mongo` instead of `mongosh` (see Stoat's README).

## Backups

Everything lives in the stack folder:

| What | Path |
|---|---|
| Database (most important) | `data/db`. Use `mongodump` or stop the stack for a consistent copy |
| Uploaded files | `data/minio` |
| Message queue | `data/rabbit` |
| TLS certificates | `data/caddy-data`, `data/caddy-config` |
| Config and keys | `secrets.env`, `Revolt.toml`, `livekit.yml`, `.env`, `.env.web`, `stoat.json`, `compose.override.yml` |

Without `secrets.env`, uploaded files can't be decrypted.

## Problems

See [Troubleshooting](Troubleshooting#server).
