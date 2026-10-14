# Changes from Stoat

AnyTalk started as a fork of the Stoat web client ([stoatchat/for-web](https://github.com/stoatchat/for-web)). It keeps Stoat's history and adds its own commits on top. Changes stay in this fork and aren't sent upstream. A few upstream pull requests that weren't merged in Stoat were adopted as well: emoji renaming, GIF search, server folders, channel reordering and accessibility fixes.

This page summarises what's different, in the client and in the backend.

## Client

### Calls, voice and screen share

- **Noise suppression:** RNNoise v3 with a speech gate and a low-cut filter. The mic signal runs through a high-pass filter, optional RNNoise, a compressor and a gain stage.
- **Stream quality:** choose up to 1440p at 60 fps for screen shares, with a confirmation step before sharing starts. 1440p needs a raised server limit, see [Configuration](Configuration#stream-resolution).
- **Streams load on demand:** a screen share is only downloaded while someone is watching it. Viewers announce what they watch, and the streamer sees a list of viewers (needs the [patched backend](Backend)).
- **Deafen indicator:** others see when you're deafened (needs the [patched backend](Backend)).
- **Fullscreen focused streams** and reworked call layouts (fullscreen, expanded, collapsed, picture-in-picture).
- **Call footer:** mute, deafen, leave, and a microphone/speaker picker at the bottom of the channel list while in a call. On iPhone it switches between loudspeaker and earpiece instead.
- **Automatic reconnect:** after a network drop, LiveKit tries to resume for 60 seconds, then AnyTalk rejoins the call itself, with back-off, for up to 2 minutes.
- **Speaking indicator** with tuned timing, which also works when LiveKit sends no audio levels.
- **Developer mode** with live call statistics and call recaps that can be compared and exported.
- LiveKit adaptive stream and dynacast, so people only receive the video quality they actually display.
- A patch to `livekit-client` that allows changing screen-share constraints while sharing.

### Mobile and iPhone

- Safe areas for rounded screen corners and the home indicator.
- Call controls and participant tiles sized for small screens, and fullscreen video.
- Safari audio fixes: an unlock prompt when the browser blocks audio, and volume control through Web Audio because iOS ignores the volume of audio elements.
- Settings shown as a full-screen list on phones.

### Desktop app

A new Electron app for Windows and Linux. Stoat has no desktop app in this repository. See [Desktop App](Desktop-App).

- Global hotkeys, tray icon, autostart.
- **Stream your game:** detects running games and offers to stream them, follows the game window when it changes, and has a hotkey for the game in front.
- **In-game voice overlay:** shows who's in the call and who's speaking, on top of games.
- Self-updates that are only installed when signed by a trusted release key.

### Sound

Message bell, ringtones for incoming calls, separate notification volumes, and vibration on incoming calls.

### Input

- Game controller navigation for the whole app.
- Keyboard support for context menus.

### Languages

- Maintained translations for German, French, Spanish, Japanese, Korean, Simplified Chinese and Arabic.
- Right-to-left layouts are mirrored properly.
- Switching the language doesn't reload the app.
- A search field in the language picker that ignores case and accents.

### Interface

- Icons in settings.
- Create a channel directly from a category's header.
- Drag and drop of voice channels (desktop).
- A friends overview on the home page: friends in calls, recent calls, online friends.
- A notice when a new version of the web app is available, which updates without a hard reload.
- A "Desktop app" settings page that lists the installers from the latest desktop release.

### Connection and performance

- The app reconnects when the network or the browser tab comes back.
- Code highlighting in messages loads only when needed.
- Only the outlined icon font is loaded.

### Build and deployment

- Renamed from Stoat to AnyTalk.
- One Docker image for any server. Backend URLs are set when the container starts instead of at build time. See [Self-Hosting](Self-Hosting).
- The dev server listens on a fixed port and is reachable from the local network, for testing on phones.

## Backend

The backend is stock Stoat except for one patched service, the **api**. The patches:

- allow every call participant to send LiveKit data messages and set their own attributes, which the stream viewer list and the deafen indicator need;
- fix the permission re-sync during calls, so members without the Video permission can't start a camera or screen share after a role change;
- fix server mute, server deafen and "disconnect from voice" so they affect the member being moderated instead of the moderator.

Details in [Backend](Backend).

On the server used for AnyTalk, two settings were changed from Stoat's defaults: the maximum video resolution was raised to allow 1440p streams, and the LiveKit configuration was tuned. See [Configuration](Configuration).

## What stays the same

Accounts, servers, channels, roles and permissions, messages, embeds, file uploads, bots and webhooks all work as in Stoat. AnyTalk uses the same API, so the client can also connect to a stock Stoat server. Only the stream viewer list and the deafen indicator need the patched backend.
