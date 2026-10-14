# Features

AnyTalk has everything the Stoat web app has: servers, channels, roles, direct messages, groups, friends, embeds, file uploads, emoji, bots and webhooks. This page covers what AnyTalk adds or changes. For the full list compared with Stoat, see [Changes from Stoat](Changes-from-Stoat).

## Voice and video calls

Join a voice channel to start a call. While you're in a call, a bar at the bottom of the channel list shows the channel and has buttons for mute, deafen and leave.

### Voice settings

Settings → **Voice**:

| Setting | Options |
|---|---|
| Input / output device, camera | Pick from your devices |
| Input volume, output volume | 0–300 % |
| Noise suppression | Disabled, Browser, Enhanced (RNNoise) |
| Mute when not speaking | Speech gate, available with Enhanced noise suppression |
| Low-cut filter | Off, Light (60 Hz), Medium (90 Hz), Strong (150 Hz) |
| Echo cancellation, automatic gain control | On / off |

AnyTalk uses voice activity. There's no push-to-talk.

You can switch microphone and speaker during a call from the arrow next to the mute button. On iPhone, that menu is a **Loudspeaker / Phone call** toggle instead.

### Volume per person

Each person and each stream in a call has its own volume slider, from 0 to 300 %. Above 100 % the sound is boosted with Web Audio. On iPhone, volumes above 100 % aren't possible.

### Screen sharing

Settings → Voice → **Screen Share Settings**:

| Setting | Options |
|---|---|
| Resolution | 720p, 1080p, 1440p, Source (native size) |
| Frame rate | 5, 15, 30, 60 fps |
| Always ask for screen share quality | Shows the quality picker each time you start sharing |
| Watch multiple streams at once | Show several streams side by side, or replace the one you're watching |

The options are limited to what the server allows. If the server's limit is lower than your choice, the next smaller resolution is used. Server owners: see [Configuration](Configuration#stream-resolution).

A stream is only downloaded while someone watches it, which saves bandwidth for everyone. The streamer sees who is watching, and everyone sees who is deafened. Both need the [patched backend](Backend).

On phones, screen sharing isn't available, because mobile browsers don't support it.

### Reconnecting

If your connection drops during a call, AnyTalk first waits up to 60 seconds for the call to resume, then rejoins it on its own for up to 2 more minutes. When the network or the browser tab comes back, the rest of the app reconnects too.

### Developer mode

Settings → **Developer** has tools for finding call problems:

- **Voice call developer mode:** live microphone statistics on the call tiles.
- **Stream developer mode:** statistics for screen shares.
- **Call stats:** a live overlay, recording and recaps of earlier calls.
- **Compare recaps:** put your recap next to recaps from other people (CSV). Recaps can be exported as CSV or zip.

## iPhone and mobile

- The layout respects rounded screen corners and the home indicator.
- Call controls and participant tiles fit small screens. Videos can go fullscreen.
- Safari doesn't play audio until you tap. If a call starts without sound, AnyTalk shows a prompt to tap and turn it on.
- Switching between loudspeaker and earpiece only works when triggered by a tap, which Safari requires.
- Settings open as a full-screen list.

Calls only work over HTTPS. A server reached over plain `http` (other than `localhost`) can't use the microphone or camera.

## Desktop app

For Windows and Linux, with global hotkeys, game streaming and an in-game overlay. See [Desktop App](Desktop-App).

## Keyboard shortcuts

| Action | Default |
|---|---|
| Previous / next channel | Alt+↑ / Alt+↓ |
| Previous / next server | Ctrl+Alt+↑ / Ctrl+Alt+↓ |
| Mark channel as read, jump to the end, focus the message box | Escape |
| Mark server as read | Shift+Escape |
| Start typing a message | Any letter or digit |
| Close dialog, menu or sidebar; cancel editing | Escape |
| Mute / unmute | Ctrl+Shift+M |
| Deafen / undeafen | Ctrl+Shift+D |
| Stream the game in front (desktop app) | Ctrl+Shift+G |
| Show / hide the overlay (desktop app) | Ctrl+Shift+O |

On macOS, Alt in the channel shortcuts is Command.

The last four can be changed or turned off in Settings → **Hotkeys**. A hotkey can be a single key, and numpad keys count as separate keys. In the desktop app, these four also work while AnyTalk isn't focused.

Context menus can be opened and used with the keyboard.

## Game controller

Settings → **Controller** turns on controller navigation. It's off by default.

| Button | Action |
|---|---|
| D-pad / left stick | Move between buttons, menus and messages |
| A (bottom) | Press the selected item, or send a message |
| B (right) | Go back: close a menu or dialog, leave the message box |
| X (left) | Open the context menu of the selected item |
| Y (top) | Write a message |
| LB / RB | Previous / next channel |
| LT / RT | Previous / next server |
| Right stick | Scroll |
| View / Back | Mute / unmute in a call |
| Menu / Start | Jump between servers, channels, messages and members |

Buttons are by position, so the layout works the same on Xbox, PlayStation and other controllers.

## Sounds and notifications

Settings → **Notifications**:

- A message bell, ringtones for incoming calls, and sounds for joining, leaving and streams.
- An overall volume, plus volume and a custom sound file per sound.
- Vibration on incoming calls (on devices that support it).

## Languages

Settings → **Language**. German, French, Spanish, Japanese, Korean, Simplified Chinese and Arabic are kept complete. Many other languages are available with varying completeness. Right-to-left languages such as Arabic mirror the whole layout. Switching languages doesn't reload the app, and the language list has a search that ignores case and accents.

## Home page

The home page shows friends who are in a call, your recent calls and friends who are online. Recent calls can be hidden in Settings → Advanced.

## Other settings

Settings → **Advanced**:

- Compact mode
- "Copy ID" in context menus
- Admin panel shortcuts in context menus
- A notice when a new version of the web app is available. Updating doesn't need a hard reload.
- Recent calls on the home page

The web app also has a **Desktop app** page that lists the installers from the latest desktop release.
