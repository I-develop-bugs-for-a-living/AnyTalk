# Troubleshooting

## Calls

### I can't hear anything on iPhone

Safari only plays audio after a tap. Tap the prompt that appears in the call. Volume above 100 % isn't possible on iPhone.

### The microphone or camera doesn't work

Browsers only allow the microphone, camera and screen sharing on `https://` pages (and on `localhost`). If you open AnyTalk through a plain `http://` address, calls can't use them. Also check the browser's site permissions.

### Nobody sees who is watching my stream, or that I'm deafened

These two features need the [patched backend](Backend). On a stock Stoat server they don't work, and the browser console shows errors like *"does not have permission to update own metadata"*. The call itself works normally.

### I get kicked from the call when I share my screen

The stream is larger than the server allows. Pick a lower resolution in Settings → Voice → Screen Share Settings, or ask the server owner to raise `video_resolution` (see [Configuration](Configuration#stream-resolution)).

### There's no screen share button on my phone

Mobile browsers don't support screen sharing.

### The call drops and comes back

AnyTalk reconnects by itself, for up to about 3 minutes. If calls drop often, the connection between you and the server is losing packets. Developer mode (Settings → Developer) shows call statistics, and its recaps can be exported and shared with the server owner.

## Desktop app

### A global hotkey doesn't work

- Settings → Hotkeys marks hotkeys that couldn't be registered. Another app probably uses the same keys. Pick different ones.
- On Wayland, the desktop has to allow the shortcuts. On Hyprland, bind them yourself (see [Desktop App](Desktop-App#wayland)).

### My game isn't detected

- Check that "Detect running games" is on in Settings → Desktop.
- Look at `logs/games.log` in the app's data folder ([where](Desktop-App#files-and-folders)).
- Add the game to `games.json` yourself ([how](Desktop-App#adding-your-own-games)).
- On Wayland, games are detected but their window can't be selected automatically. Pick it in the screen picker.

### The app doesn't update

Only the Windows installer and the AppImage update themselves. With deb, rpm or pacman, install the new version from the Releases page. If an update shows "failed", the release may not be signed yet. The app retries every 4 hours and on the next start.

### The app shows an offline page

The server isn't reachable. Use Retry, or enter another server URL on that page.

## Server

### Calls fail to connect

1. Check LiveKit:
   ```bash
   curl -s -w '\n%{http_code}\n' https://chat.example.com/livekit
   ```
   It should print `OK` and `200`. A `502` means LiveKit isn't running.
2. Read its log: `docker compose logs livekit`. If it keeps restarting with an error like `yaml: line 6: did not find expected key`, `livekit.yml` has an indentation mistake. YAML often reports the line *before* the actual mistake. Look for a stray space in front of a top-level key such as `redis:`.

### Calls connect, but nobody hears anything

The media ports aren't reachable. Check that 7881/TCP and 50000–50100/UDP are open in the firewall and forwarded on the router, and that `use_external_ip: true` is set in `livekit.yml`. To see which connection a call actually uses, open `chrome://webrtc-internals` during a call and check the selected candidate pair. Test with someone on a different network.

### The app loads, but can't connect or log in

- `curl -s https://chat.example.com/api` should return JSON with the URLs of `ws`, `autumn`, `january` and `livekit`. Check that they use your domain.
- `Revolt.toml`, `.env.web` and `stoat.json` must use the same domain.
- After changing `.env.web`, restart the `web` container.
- Behind your own reverse proxy, websocket upgrades must be forwarded for `/ws` and `/livekit`.

### I can't open a shell in a Stoat container

The official Stoat images have no shell. Use `docker compose logs <service>` for errors, and `curl -s https://chat.example.com/api` to see the version and the configured URLs.

### The database doesn't start after an update

`docker.io/mongo:8` may have pulled a newer version. Pin MongoDB to an exact version (see [Self-Hosting](Self-Hosting#pin-mongodb)). On old CPUs without AVX, use `mongo:4.4`.

### The patched api build fails after a Stoat release

A patch probably no longer applies to the new Stoat code. Stay on the previous version until the patch is updated. See [Backend](Backend#updating-to-a-new-stoat-release).

## Reporting a problem

Open an issue on [GitHub](https://github.com/I-develop-bugs-for-a-living/AnyTalk/issues). Include:

- the device, operating system and browser, or the desktop app version;
- what you did, what you expected and what happened;
- for call problems, a recap from developer mode if possible.
