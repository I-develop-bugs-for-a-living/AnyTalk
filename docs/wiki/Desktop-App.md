# Desktop App

The AnyTalk desktop app is an Electron app for Windows and Linux. It loads the AnyTalk web app from your server in its own window and adds what a browser can't do: global hotkeys, game detection, an in-game overlay, tray and autostart, and automatic updates.

## Download

Installers are on the [Releases page](https://github.com/I-develop-bugs-for-a-living/AnyTalk/releases) under the `desktop-v<version>` tags. In the web app, Settings → **Desktop app** lists the newest ones.

| System | File | Updates itself |
|---|---|---|
| Windows | `AnyTalk-Setup-<version>.exe` (installer) | Yes |
| Linux | `AnyTalk-<version>-<arch>.AppImage` | Yes |
| Linux (Debian, Ubuntu) | `.deb` | No, install the new version yourself |
| Linux (Fedora, openSUSE) | `.rpm` | No |
| Linux (Arch) | `.pacman` | No |

There's no macOS version.

## Choosing the server

The app opens the server it was built for. To use another one, go to Settings → **Desktop** → Advanced, enter the server URL and save. The app reloads with the new server. "Reset to default" goes back.

The URL is chosen in this order:

1. The `ANYTALK_URL` environment variable, if it's a valid `http(s)` URL.
2. The server URL from the settings.
3. The default built into the app (`ANYTALK_DEFAULT_URL` at build time).

If the server can't be reached, an offline page offers Retry, a field for another URL, and Reset.

## Settings

Settings → **Desktop**:

- Start with computer
- Minimise to tray: the close button hides the window to the tray instead of quitting
- Start minimised
- Custom window frame (AnyTalk's own title bar)
- Spellchecker
- Hardware acceleration
- Detect running games
- Server URL (Advanced)

Clicking the tray icon shows or hides the window. The tray menu has Quit and, once an update is ready, Restart to update. If the Linux desktop has no tray, closing the window doesn't hide it, and "start minimised" minimises the window instead.

Only one AnyTalk window runs at a time. Starting it again brings up the running one.

## Updates

The Windows installer and the AppImage update themselves from GitHub Releases. When an update is downloaded, **Restart to update** appears in the tray and File menu, and Settings → **Updates** shows a dot. Otherwise the update is installed when you quit.

An update is only installed if it carries a valid signature from a trusted AnyTalk release key. Unsigned or tampered downloads are deleted and the app shows "update failed". Versions up to 0.3.1 didn't check signatures.

## Stream your game

With "Detect running games" on, AnyTalk notices when you start a known game during a call and offers to stream it, without the usual screen picker.

- **Follow mode:** if the game's window changes (for example from the launcher to the match), the stream switches to the new window by itself. Viewers keep watching through the switch.
- **Hotkey:** Ctrl+Shift+G starts, switches or stops the stream of the game in front.
- Detection runs on your computer only. Nothing about your games is sent to the server.
- On Windows and Linux (X11) AnyTalk finds the game's window. On Wayland it only detects that the game runs, and the system's screen picker still appears.

### Adding your own games

AnyTalk knows about 80 games. To add more, create `games.json` in the app's data folder (see [Files and folders](#files-and-folders)):

```json
[
  {
    "id": "my-game",
    "name": "My Game",
    "executables": { "win32": ["MyGame.exe"], "linux": ["mygame"] },
    "windowTitles": { "game": ["My Game"] }
  }
]
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique id. Using a built-in game's id replaces that entry. |
| `name` | yes | Name shown in AnyTalk |
| `executables` | yes | Process names per system (`win32`, `linux`), case doesn't matter. On Linux, the `win32` names also match games running through Proton or Wine. |
| `clients` | no | Process names of the launcher. Any other process of the entry counts as the game. |
| `gameNames` | no | Display name per executable |
| `windowTitles` | no | Exact window titles to fall back on: `game` and `client` lists |

Ids and names can be up to 100 characters. A broken file is ignored. Restart AnyTalk after editing it. If a game isn't detected, look at `logs/games.log` in the same folder.

## In-game overlay

A small window on top of your games that shows who's in the call. Avatars light up with a green ring while someone speaks. Clicks go through it to the game.

Settings → **Overlay**:

| Setting | Options |
|---|---|
| Show overlay | On / off |
| Position | Any corner of the main screen |
| When to show | Whenever I'm in a call, or only while a detected game is running |
| Style | Compact (avatars only) or Detailed (adds the name of whoever speaks and a LIVE tag for streams) |

Ctrl+Shift+O shows or hides it.

## Global hotkeys

Mute, deafen, stream game and overlay hotkeys work even while AnyTalk is in the background. Change them in Settings → **Hotkeys**. If a hotkey can't be registered, for example because another app uses it, the Hotkeys page marks it.

### Wayland

On Wayland, global hotkeys go through the desktop's GlobalShortcuts portal. Depending on the desktop, it may ask you to confirm them.

**Hyprland** doesn't assign keys by itself. Bind them in your Hyprland config:

```bash
hyprctl globalshortcuts   # lists AnyTalk's shortcut ids
```

```ini
bind = CTRL SHIFT, M, global, tech.anyportal.AnyTalk:<id>
```

The Hotkeys page shows this help when it detects Hyprland.

## Files and folders

| What | Windows | Linux |
|---|---|---|
| Data folder | `%APPDATA%\AnyTalk` | `~/.config/AnyTalk` |
| Settings | `config.json` in the data folder | same |
| Own games | `games.json` in the data folder | same |
| Game detection log | `logs\games.log` | `logs/games.log` |
| Autostart | Login item | `~/.config/autostart/tech.anyportal.AnyTalk.desktop` |

## Building and releasing

See [Development](Development#desktop-app) and [`packages/desktop/RELEASING.md`](https://github.com/I-develop-bugs-for-a-living/AnyTalk/blob/main/packages/desktop/RELEASING.md).
