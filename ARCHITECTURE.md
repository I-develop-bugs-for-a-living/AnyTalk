# AnyTalk architecture

Project map for planning. It describes feature areas and how they connect, not individual functions. Paths are relative to `packages/client` unless they start at the repo root. Committed with the code. Update it when a change adds, moves or removes a feature area.

## Repo layout

- `packages/client`: the app (SolidJS, PandaCSS, Vite). All regular work happens here.
- `packages/stoat.js`: git submodule, the API/WebSocket SDK. Holds the reactive collections (servers, channels, users, messages) and REST calls such as `channel.joinCall()`.
- `packages/solid-livekit-components`: git submodule, Solid bindings for LiveKit (room/participant/track contexts, `TrackLoop`, `VideoTrack`, `useTracks`).
- `packages/client/assets`: private submodule with brand assets, may be missing.
- `patches/livekit-client.patch`: pnpm patch that adds runtime screen-share constraints (`applyScreenShareConstraints`) to livekit-client.
- `pnpm-workspace.yaml` (solid-js pinned to 1.9.14), `.mise/` (tasks and tool versions), `git-town.toml`.
- `Dockerfile`, `docker/inject.js`: two-stage build, with backend URLs injected at container start instead of baked in. `.github/workflows/docker.yml` publishes to GHCR on pushes to `main`.

## Two UI roots

The screens are split across two folders. Check both when looking for UI.

- `src/`: entry point, router and the app shell. `src/interface/` holds the shell pieces: sidebars, home, friends, discover, server home, `ChannelPage` and `TextChannel` (the channel page frame).
- `components/app/` (`@revolt/app`): the larger feature screens. `interface/channels/text` (message list), `interface/settings`, `interface/desktop`, plus `menus/` (context menus).

## Aliases (`tsconfig.json`)

Each `@revolt/*` alias maps to `components/*`:

| Alias | Purpose |
|---|---|
| `@revolt/app` | feature screens (messages, settings), context menus |
| `@revolt/auth` | login/register flows |
| `@revolt/client` | client lifecycle controller, sounds |
| `@revolt/instance` | wraps the stoat.js `Client`, instance config and limits |
| `@revolt/state` | persisted stores |
| `@revolt/modal` | modal controller and all modals |
| `@revolt/routing` | router re-exports and URL param parsing |
| `@revolt/rtc` | calls, screen share, audio processing |
| `@revolt/traffic` | traffic inspector recorder (see Traffic inspector) |
| `@revolt/ui` | shared components, themes, directives, call UI, composer |
| `@revolt/markdown` | message markdown pipeline |
| `@revolt/i18n` | Lingui setup and language loading |
| `@revolt/keybinds` | keyboard shortcuts; hotkeys can be a single key, and numpad keys are told apart from the main row (`keybindSequences.ts`). Keybinds can also run on release (`useTriggerKeybindRelease`, used by push to talk). `GlobalKeybinds` registers desktop-app global hotkeys through `window.native` for every enabled hotkey (`accelerator.ts` converts key sequences), sends each binding's physical `code` (`keyCodes.ts`), and reads the shell's capabilities to know whether releases arrive |
| `@revolt/gamepad` | game controller support (see Game controller) |
| `@revolt/common` | shared utilities, env config |

## Startup and data flow

```
src/index.tsx
  DeviceContext → I18nProvider → SnackbarProvider → Router
    InstanceContext   (stoat.js Client per host, config from /.well-known/stoat or env)
    StateContext      (stores hydrated from IndexedDB)
    ClientContext     (lifecycle controller)
      /login/*  → @revolt/auth flows
      /         → src/Interface.tsx (shell; redirects to /login if not logged in)
```

1. **Instance** (`components/instance/Instance.ts`) creates the stoat.js `Client` from env (`components/common/lib/env.ts`: `VITE_HOST`, `VITE_API_URL`, `VITE_DEV_*`) or from an instance's `/.well-known/stoat` (multi-instance via `/i/:host/`).
2. **State** (`components/state/index.tsx`) hydrates all stores from IndexedDB (localforage) on mount.
3. **Client controller** (`components/client/Controller.ts`) runs a lifecycle state machine: Ready → LoggingIn → Connecting → Connected (→ Reconnecting / Error / Disposed). With a saved session from the `Auth` store it logs in from cache. Otherwise the user goes through `/login`. Socket events from stoat.js drive the transitions. Browser `online` and tab-visible events go through `components/client/lifecycleWake.ts` (`actionOnWake`), which retries a backoff wait, leaves the offline state or closes a dead socket, but never opens a second connection. After the tab was hidden for over 15 s, a wake pings the socket and reconnects only if no Pong arrives within 3 s. `client/disconnectedIndicator.ts` turns on the disconnected look only after 2.5 s offline, so quick reconnects don't flash it.
4. **To the UI:** components read stoat.js's reactive collections through `useClient()` (e.g. `client().channels.get(id)`) and persisted preferences through `useState()`. stoat.js objects such as `Server`, `Channel` and `Message` are passed straight into components and modals as props. Their methods (`havePermission`, `send`, `joinCall`) are the API layer, so there's no separate service layer.
5. **Writes** go through stoat.js methods. The WebSocket events then update the reactive collections, and the UI follows.

## State stores (`components/state/stores`)

Every store extends `AbstractStore` (`stores/index.ts`), validates its data in `clean()`, and writes to IndexedDB with a debounce of about 1.2 s (`Auth` writes right away). Docs: `doc/src/components/state/state.md`, `creating.md`.

| Store | Holds |
|---|---|
| `Auth` | session token, user id |
| `Draft` | unsent message text, staged files and replies per channel |
| `Settings` | generic key/value app settings (`appearance:*`, `notifications:*`, `controller:enabled`, `controller:ptt_button`, `controller:bindings` (this device only, not synced), ...) |
| `Layout` | open sections, sidebar visibility, active interface |
| `Ordering`, `ServerFolders` | server/channel/conversation order, server folders |
| `PinnedConversations` | DM and group DM ids pinned to the server rail. Own synced key (`pinned-conversations`), so clients without it don't drop the pins. Pure rules in `stores/pinOrder.ts` |
| `Voice` | devices, input mode (voice activity or push to talk), noise suppression mode, screen-share quality, volumes |
| `Sounds`, `NotificationOptions` | sound/ringtone choices, notification preferences |
| `Theme`, `Locale` | theme preset and fonts, language |
| `Keybinds`, `LinkSafety`, `Experiments`, `ReleaseNotes`, `Sync` | shortcuts, trusted links, feature flags, seen changelog, cross-device sync |

## Feature areas

### Login and auth
- Lives in `components/auth/src/flows/`: home, login, create, verify, reset, confirm reset, resend, check, delete account. `Flow.tsx` and `Form.tsx` are the shared frame.
- Key files: `components/auth/src/flows/FlowLogin.tsx`, `components/client/Controller.ts` (login, MFA, logout), `components/state/stores/Auth.ts` (session persistence).
- MFA and "signed out" are modals (see Modals). Docs: `doc/src/components/client/session-lifecycle.md`.

### Navigation and app shell
- Routes are defined in `src/index.tsx`: `/friends`, `/servers`, `/discover/*`, `/server/:server`, `/server/:server/channel/:channel`, `/channel/:channel` (DMs, groups, saved notes), `/settings`, `/invite/:code`, `/bot/:code`.
- `components/routing/index.tsx`: `useSmartParams()` reads server/channel/message ids from the URL. The URL is the source of truth for what's on screen.
- Key files: `src/Interface.tsx` (shell: titlebar, sidebars, content), `src/interface/Sidebar.tsx` (shows the server sidebar or the home sidebar), `src/interface/navigation/servers/ServerList.tsx` (server rail, drag reorder, user menu).
- Inbox: the button below Home on the rail opens `src/interface/navigation/servers/Inbox.tsx` (popover on desktop, `BottomSheet` from `@revolt/ui` on phones). Data comes from `channel.mentions` (unread mention IDs from `/sync/unreads` and live messages), so only unread mentions show, there is no history. The server also stores every unread DM/group message there. While the app is open, `createInboxMentions` adds DM/group messages, role mentions we hold and @everyone from `messageCreate` (the library skips them live); these extras are in memory only, lost on reload, and dropped once the channel's last-read id passes them. Mentions in muted channels or servers (`Channel.muted`) are hidden. Collecting, sorting (newest first, 50 max), counting and the fetch limiter are pure code in `inboxMentions.ts`; messages are fetched lazily when rows render. "Mark all read" uses `ackNow`.
- Channel list: `src/interface/navigation/channels/ServerSidebar.tsx` (categories, drag, keyboard navigation), `HomeSidebar.tsx` (DMs, saved notes). Both show `VoiceStatusFooter` at the bottom during a call.
- Pinned DMs: shown on the server rail (`ServerList.tsx`) after the unread-DM shortcuts and before a separator and the servers. `Ordering.pinnedConversations()` returns them in pin order; `src/interface/Sidebar.tsx` leaves pinned chats out of the unread shortcuts so they show once. The Home sidebar DM list stays in recent order. Pins are toggled from the user and channel context menus (`components/app/menus/shared/PinConversationButton.tsx`). The user avatar sits at the bottom of the rail and opens `UserMenu.tsx`, which also holds the Settings item.
- Channel page: `src/interface/channels/ChannelPage.tsx` resolves the channel from the URL, and `src/interface/channels/text/TextChannel.tsx` lays out the header, message list, composer and member sidebar (`ServerMemberSidebar` / `GroupMemberSidebar`).
- Shared interface components: `src/interface/common/CommonHeader.tsx` exports `HeaderIcon`, a wrapper for header icons that handles sidebar toggle behavior on desktop and mobile with RTL support.
- Server overview: `/servers` (`src/interface/servers/ServerOverview.tsx`) lists joined servers as cards with search and sorting; folder grouping, sorting and filtering are pure code in `serverOverview.ts`. Reachable from the Home sidebar, the server rail and the Home page. The header holds the "Create server" and "Join a server" buttons, which open those dialogs directly (they are no longer on the rail). `src/interface/common/ServerBadge.tsx` is the shared official/verified badge.
- Home page friends overview: `src/interface/home/FriendsOverview.tsx` (friends in calls, recent calls, online friends) with pure logic in `friendsOverview.ts`. Recent calls are recorded per user in the `Voice` store (`recentCalls`, helpers in `components/state/stores/recentCalls.ts`) when a call connects.
- Mobile: sidebars sit in `components/ui/components/navigation/SlideDrawer.ts`. Visibility is in the `Layout` store, order in `Ordering` and `ServerFolders`.
- Docs: `doc/src/user-interface/navigation/`, `doc/src/responsive/`.

### Chat and messaging
- Message list: `components/app/interface/channels/text/`. `Messages.tsx` fetches, caches, scrolls and reacts to channel events. `Message.tsx` renders one message.
- Message parts: `components/ui/components/features/messaging/elements/` (embeds, attachments, replies, reactions, system messages, toolbar). `bars/` holds typing/slowmode info, jump to bottom and new messages.
- Composer: `components/ui/components/features/messaging/composition/MessageBox.tsx` (CodeMirror-based `TextEditor2`, autocomplete, emoji/GIF pickers, file carousel). Drafts and staged files go to the `Draft` store, and sending goes through stoat.js `channel.send()`.
- Read state: `components/common/lib/ackNow.ts` acks a message at once and cancels the older debounced ack, so the read position never moves backwards.
- Markdown: `components/markdown/` is a unified/remark/rehype pipeline with plugins for mentions, emoji, channels, spoilers, timestamps and code blocks. Code highlighting is lazy-loaded.
- Context menus for messages, users, channels and servers: `components/app/menus/`, positioned with floating-ui.
- Docs: `doc/src/user-interface/channels/text-channels.md`.

### Voice, calls and screen share
- Logic: `components/rtc/`. `state.tsx` (the `Voice` class) owns the room lifecycle, mic/camera/screen toggles, focus and layout. `VoiceProcessor.ts` runs the mic pipeline (high-pass, optional RNNoise in `rnnoise/`, compressor, gain). Also here: `speaking.ts`, `screenCapture.ts`, `stats.ts`/`callStats.ts`, `volumeBoost.ts`, `virtualMic.ts` (Wayland stream audio), and `components/` (`RoomAudioManager`, `StreamViewers`, `VoiceKeybinds`). Pure, unit-tested helpers sit next to them: `audioLevel.ts`, `sourceAge.ts`, `reconnect.ts` (SDK reconnect window of 60 s, then the app's own rejoin with backoff, up to 120 s) and `outputBus.ts`.
- End-to-end encryption of call media: `components/rtc/e2ee/`, always on, no settings. `crypto.ts` (WebCrypto: per-call ECDH keys, key wrapping, signed hellos, device identity) and `session.ts` (framework-agnostic state machine: hello, per-recipient key wraps over data messages with topic `anytalk:e2ee`, rotation when someone leaves, replay protection, trust on first use with pins, downgrade handling) are pure and unit-tested. `keyProvider.ts` is the one place that imports livekit-client's E2EE key provider. `identityStore.ts` (IndexedDB) and `pinStore.ts` (localStorage) keep the device identity and pins across calls. `callE2ee.ts` ties one `Room` to the session: it builds the room's `e2ee` option and the worker (`worker.ts`, bundled by Vite and loaded only in calls), publishes the hello as the `e2ee` participant attribute, feeds visible participants (`room.remoteParticipants` only) and data messages into the session, refuses unencrypted remote tracks, and exposes reactive state (`voice.e2ee()`) for a future UI. `Voice` (`rtc/state.tsx`) creates it per room in `#open`, gates publishing the mic until the session started, and disposes it (terminating the worker) in `#teardown`. Browsers that cannot encrypt are refused (`voice.e2eeUnsupported()`); that, a worker that fails to load or crash, and a key exchange that cannot start leave the call and show a snackbar (`voice.e2eeNotice()`, `rtc/components/E2eeNotices.tsx`). Remote tracks without encryption are never subscribed or shown (filters in `RoomAudioManager`, `vidTracks`, `popOut`); anything published before our key is installed fails closed because frames without a key are dropped. Lost key messages are recovered by key requests (`req`) and a resend after reconnects.
- Output routing: `outputBus.ts` (Safari call audio: all remote voices mixed into one hidden <audio> whose setSinkId is switched inside a tap), used by `RoomAudioManager` and `Voice.setAudioOutput`/`setAudioInput`, which also re-check the mic after a switch (`#recoverMicrophone`).
- UI: `components/ui/components/features/voice/`. `callCard/VoiceCallCardActiveRoom.tsx` holds the tiles (`ParticipantTile`), focused stream, controls and fullscreen/expanded/collapsed layouts. Also `VoiceCallCardPiP.tsx`, `VoiceCallCardPreview.tsx` and `VoiceChannelPreview.tsx` (join entry in the sidebar).
- Call footer: `callCard/VoiceStatusFooter.tsx` is the bottom bar of the channel sidebars while in a call (state, channel link, mute, deafen, leave). It uses `VoiceCallButtons.tsx` and the device picker: `AudioDevicesButton` and `AudioDeviceMenu` (Microphone/Speaker menu, non-iOS, opened from `AudioDeviceChevron`) and `EarpieceToggleButton` (iOS Loudspeaker/Phone call toggle, via `findEarpiece`). `volumePanelState.ts` keeps the call card's auto-hiding controls awake while a volume panel is open.
- Join flow: `voice.connect(channel)` picks a LiveKit node by latency, then `channel.joinCall()` (stoat.js) returns a URL and token. A LiveKit `Room` is created with defaults from the `Voice` store, room events update the `Voice` signals, and the UI reads them through `useVoice()` and the solid-livekit contexts.
- Streams are subscribed only while someone watches them: `StreamViewers` announces watched streams over LiveKit data messages. Quality (up to 1440p60) comes from the `Voice` store and the livekit patch.
- iOS/mobile: audio needs a user gesture (the `audioBlocked` signal plus an unlock prompt), volume goes through an AudioContext gain because iOS ignores element volume, and there's no screen share on phones. None of this can be tested over the plain-http phone link.
- Push to talk (`inputMode` "ptt" in the `Voice` store, picked under voice input options): the mic stays closed until a source holds the key. Two sources, keyboard and controller, are tracked separately in `state.tsx` (`pushToTalk(down, source)`, `syncMicrophone()`), and the mic stays open while either holds it. Releasing keeps it open for 200 ms. A mute choice is never changed by push to talk. Pure rules and tests: `rtc/pushToTalk.ts`. The key is the `VOICE_PUSH_TO_TALK` keybind (`components/rtc/components/VoiceKeybinds.tsx`). On the desktop app it is also a global hotkey, and `GlobalKeybinds` only uses the global press and release when the shell reports releases. Otherwise the in-app key counts and losing focus releases it. `rtc/components/GamepadPushToTalk.tsx` (mounted for the whole session) tells the shell the controller button and feeds its presses in as source `pad`.
- Join, leave and stream sounds: `@revolt/client` SoundController. Settings pages for voice live in user settings.

### Stream popout
- A watched stream or camera tile can be shown in a window of its own (button on `ParticipantTile`, placeholder with "Bring back" in the tile meanwhile). State lives on `Voice` in `rtc/state.tsx` (`popouts` keyed by track id, `popOut`, `closePopout`, `closeAllPopouts`); it never changes `watching` or focus.
- `rtc/streamPopout.ts` (pure helpers unit-tested): picks the API, sizes the window, copies styles and theme attributes into it. Browsers use Document Picture-in-Picture (always on top) and fall back to a same-origin `window.open` popup. Touch-only devices don't get the button.
- `rtc/components/StreamPopouts.tsx` (mounted in `VoiceContext`) renders the video into the window through a Solid `Portal` and closes it when the stream ends, is unwatched or the call is left. Events in it must be native (`on:click`).
- Desktop app: `window.native` forces the popup path; `setWindowOpenHandler` in `packages/desktop/src/main/index.ts` allows only `about:blank` with the frame name prefix `anytalk-stream-popout` as a normal framed window (taskbar, resizable, fullscreen, no always-on-top) and locks its navigation.
- LiveKit `adaptiveStream` runs with `pauseVideoInBackground: false`, and `patches/livekit-client.patch` counts a video attached in another window as visible, so a popup keeps playing (and sized by its window) while the main window is minimized. Document PiP allows one window, popping out a second stream sends the first back to its tile. The desktop preload never exposes the native bridge in a popout.

### Stream your game (desktop app only)
- Detection runs in the Electron main process, never in the page. `packages/desktop/src/main/games.ts` finds running games: Windows uses `tasklist` plus a PowerShell window-to-pid lookup, Linux reads `/proc` and uses `xprop` for X11 windows. On Wayland it only detects games, because window picking would open the portal picker.
- Each scan has a generation counter, so an older scan that finishes late is dropped. External commands have timeouts and the whole scan has a 25 s cap. A process whose window handle is not known yet is retried per pid with back-off (`gameMatch.ts`: every 4 s, then every 15 s after 30 s). Each game entry can list `windowTitles` (game and client) as a fallback, e.g. League: "League of Legends (TM) Client" for the game.
- `main/gameLog.ts` writes diagnostics to `userData/logs/games.log` (`%APPDATA%\AnyTalk\logs` on Windows). It rotates once at about 1 MB and logs only on change, and only matched games and their windows.
- `main/gameMatch.ts` matches processes and windows to game entries (pure, unit-tested). The list is `shared/games.ts`: the bundled `GAME_LIST` plus the user's `userData/games.json`.
- Only matched games cross the bridge: IPC `games:get` / `games:changed`, exposed through `window.native` (`RunningGame` type in `shared/games.ts`). The on/off switch is the `gameDetection` config key, set by "Detect running games" in `settings/user/Native.tsx`.
- Renderer: `components/rtc/runningGames.ts` (fetch and subscribe), `components/rtc/gameFollow.ts` (pure follow decision and the 4 s grace window, unit-tested). `Voice.startGameStream(gameId)` in `rtc/state.tsx` picks the best window, preselects it with `setNextScreenSource`, then captures and publishes it. Follow mode swaps the source with `replaceTrack` when the game's window changes. While following, `#watchStall` in `rtc/state.tsx` polls the stream's `framesSent` (getStats) every 2 s; if it stands still for 5 s (`isStalled` in `gameFollow.ts`), the games are looked up again to re-sync the follow.
- `main/screen.ts`: `setNextScreenSource` is a one-shot preselection, limited to detected game windows. If the source is gone, the request is cancelled and the picker is not shown.
- The prompt is `ui/components/features/voice/callCard/GameStreamPrompt.tsx`, shown in the call footer (`VoiceStatusFooter.tsx`). Nothing about games goes to the server.
- Hotkey: the "stream focused game" action (`keybindActions.ts`) calls `decideFocusedGameStream` in `rtc/focusedGame.ts` (pure, unit-tested) to start, swap or stop the stream of the game in front.
- Viewers: a followed stream sets the `streamFollow` participant attribute (`rtc/streamFollow.ts`), so viewers wait up to 20 s for a source swap to republish. `rtc/rewatch.ts` lets viewers pick up the same person's stream again within 30 s of it ending.

### In-game voice overlay (desktop app only)
- A click-through, always-on-top window that shows the participants of the current call over games. Avatars are dim while quiet and bright with a green ring while speaking. Style "compact" shows avatars only, "detailed" adds the name while someone speaks and a LIVE tag for streams.
- Data flow: renderer -> main -> overlay window. `components/rtc/components/OverlayPublisher.tsx` (mounted in `VoiceContext` in `rtc/state.tsx`, always, not only in a call) builds the snapshot `{ inCall, participants[] }` from the LiveKit room (one invisible `ParticipantReporter` per participant, using `useFastIsSpeaking`, ScreenShare track presence and `userInformation`). It sends only changes, at most every 80 ms, through `window.native.setOverlayState` (IPC `overlay:set`). Pure helpers with tests: `rtc/overlaySnapshot.ts`.
- `packages/desktop/src/main/overlay.ts` owns the BrowserWindow (transparent, unfocusable, `showInactive`), sanitises the snapshot, positions it in a corner of the primary display's work area and decides visibility: `overlayEnabled && inCall && participants > 0 && (mode "always" || a game is detected)`. It listens to `onGamesChange` in `games.ts`, config changes (`configSet` in `index.ts`), display changes and main-frame navigation (reset). While visible it turns `setBackgroundThrottling` off on the main window so speaking detection keeps polling.
- The page is `packages/desktop/src/overlay/` (plain TS/DOM, own CSP, bundled by `scripts/build.mjs` into `dist/overlay`). The shared preload exposes only `anytalkOverlay.onState` to it when the URL is the overlay page (`overlayPageUrl` in `AppInfo`); the shell pushes `overlay:state` (snapshot plus corner and element visibilities).
- Settings: `DesktopConfig` keys `overlayEnabled`, `overlayCorner`, `overlayMode` ("always" | "games"), and five per-element keys `overlayAvatar`, `overlayName`, `overlayLive`, `overlayStatus`, `overlayWatching` ("always" | "speaking" | "off"), validated in `main/config.ts` and client-writable. Compact and Detailed are presets that fill the five keys (`main/overlayLooks.ts`, copied in `rtc/overlayConfig.ts`); the page derives the shown preset from the values and shows "Custom" when they match neither. Config files from before these keys migrate from the old `overlayStyle` value. The snapshot carries `watchingYou` per participant (they are in `voice.viewersOf(us)` while we stream); the overlay page shows an eye for it. Client side signals and `saveOverlaySettings` are in `rtc/overlayConfig.ts`; the page is `settings/user/Overlay.tsx` (page id `overlay`, hidden without the bridge). Hotkey `TOGGLE_OVERLAY` (Ctrl+Shift+O) is handled in `OverlayPublisher` and goes through the normal global hotkey list.

### Settings
- `components/app/interface/settings/`. `Settings.tsx` is the generic frame (sidebar, breadcrumbs, page transitions, search via `virtual:settings-search`). `UserSettings.tsx`, `ServerSettings.tsx` and `ChannelSettings.tsx` are config objects (`list` / `render` / `title`) registered in `index.tsx` as `SettingsConfigurations`.
- Settings open as the `settings` modal with a `config` of user, server or channel. Server and channel pages are hidden by `havePermission()` checks on the stoat.js object.
- User settings read and write `@revolt/state` stores (`Settings`, `Voice`, `Theme`, `Sounds`, ...). Server and channel settings write through stoat.js. Shared layout lives in `_layout/`. On mobile, settings are a full-screen list (`SlideDrawer`). The web version also has a "Desktop app" page (`user/DesktopDownload.tsx`, logic in `user/desktopRelease.ts`) that lists installers from the newest `desktop-v*` GitHub release (repo from `VITE_DESKTOP_RELEASES_REPO`); it is hidden inside the desktop app.

### Modals
- `components/modal/`. `index.tsx` holds the `ModalController` (a stack, `useModals()`, `openModal` / `pop` / `closeAll`, close keybind), `types.ts` the `Modals` discriminated union, `modals.tsx` the `RenderModal` switch, and `modals/` about 50 implementations.
- To add a modal: add a type to the union, add a component in `modals/`, and add a case to the switch.
- Groups: account and MFA, server/channel create and delete, moderation (ban, kick, timeout), bots and webhooks, settings, screen-share picker and settings, viewers and dialogs (image viewer, link warning, changelog, report, invite).
- Modals receive stoat.js objects as props and report results back through callbacks or promises. Docs: `doc/src/components/modal/guidelines.md`.

### i18n
- `components/i18n/index.tsx`: Lingui with dynamic catalog loading. It sets `lang`/`dir` for right-to-left languages. Catalogs live in `components/i18n/catalogs` (generated, about 15 MB, don't read them).
- `components/i18n/languageSearch.ts`: the language picker search. It ignores case and accents and matches the names from `Intl.DisplayNames`.
- Docs: `doc/src/components/i18n/` (using-lingui, dayjs, durations, translating-errors).

### UI kit and theming
- `components/ui/`: Material 3 based components, themes, directives and `features/` (messaging, voice). `components/ui/components/floating/` holds the floating menus (`FloatingManager`) and their keyboard handling. Read `components/ui/DESIGN.md` before UI work. Docs: `doc/src/components/ui/themes/reference.md`, `doc/src/components/ui/tools/form2.md`, `doc/src/user-interface/icons.md`.

### Game controller (`components/gamepad`)
- `GamepadControls` (mounted in `src/index.tsx` next to `GlobalKeybinds`, inside `KeybindContext`) listens to `gamepadconnected`/`disconnected` only; while a pad is connected, the `controller:enabled` setting is on and the page is visible it polls `navigator.getGamepads()` per animation frame and adds a few listeners (visibility, pointer/key use). Everything is removed again otherwise.
- Pure logic (unit tested): `input.ts` (standard-layout mapping, fallback to buttons 0-3 and axes 0-1, dead zones, key repeat 400/100 ms, `PadTracker` with edge detection that ignores buttons held at connect; L3 and R3 are press buttons like the face buttons), `spatial.ts` (rect-based direction scoring, region preference, region cycling), `navigation.ts` (how a press acts on the focused element: arrow keys vs spatial vs select step, click vs Enter). `dom.ts` is the DOM glue: candidate collection, topmost layer (dialogs, settings overlay, context menu in `#floating`), synthetic key events (always keydown + keyup, so the keybind handler's held-key set never sticks), scrolling, region cycling.
- Rebindable buttons: `bindings.ts` (pure, unit tested) defines `ControllerAction` (activate, back, context menu, cycle region, composer, channel/server up and down, mute, deafen), `DEFAULT_BINDINGS` and `resolveBindings()`, which puts the user's `controller:bindings` overrides on top of the defaults. A button has one action: giving an action a button held by another swaps them (`rebind`, `unbind`, `resetAction`). Four essential actions (activate, back, context menu, cycle region) always keep a button; `rebindBlocker` refuses a change that would leave one without. `GamepadControls` maps the pressed button to an action with `actionForButton()`.
- Recording: `capture.ts` (`ButtonCapture`) takes the first button pressed after the buttons held at the start are let go, with a 10 s timeout. The settings page sets `gamepadCapturing` while it waits, and `GamepadControls` stops acting until it is cleared.
- Reuses existing pieces: `useTriggerKeybind()` for channel/server navigation, composer focus, mute and deafen (`VOICE_TOGGLE_MUTE`, `VOICE_TOGGLE_DEAFEN`); `openContextMenuFor`; `focusMessageList`; context-menu and message-list arrow-key handlers. Regions are marked with `data-region` (servers, channels, members) on the sidebars; `main` and `[data-message-list]` cover the rest.
- Fixed, not rebindable: D-pad and left stick move focus, right stick scrolls.
- Default layout (rebindable): A activate, B back (Escape), X context menu, Y composer, LB/RB channel up/down, LT/RT server up/down, View toggles mute, Start cycles Servers -> Channels -> Messages -> Members. Deafen has no button by default.
- `data-input="gamepad"` on `<html>` (set on controller use, cleared on trusted mouse/touch/keyboard use) turns on `:focus` rings in `components/ui/styles.css`.
- Push to talk button: `gamepad/pushToTalkButton.ts` (button names, saved in `controller:ptt_button`, and whether the desktop shell accepted it). The chosen button is hidden from navigation with `maskButton` in `input.ts`, so it only acts as push to talk. Its presses come from the desktop shell (see Desktop shell), not from `GamepadControls`, and only work on Windows.
- Settings page: `components/app/interface/settings/user/Controller.tsx` (page id `controller`, also listed in `settingsSearch.plugin.ts`). It is the rebinding UI: one row per action with its button, a recorder to pick a new one, a reset per action and "Reset all buttons". Bindings are saved in the `controller:bindings` setting.

### Traffic inspector
- `components/traffic/` (alias `@revolt/traffic`), chunk 1: the recorder only, no UI yet. Meant for cross-checking what the app sends against Wireshark. Off by default, memory only, cleared on reload, nothing is sent anywhere.
- `src/index.tsx` calls `startTrafficInspector()` after the early `./sentry` import and before the stoat.js `Client` exists. `install.ts` replaces global `fetch`, `XMLHttpRequest` (prototype) and `WebSocket` (subclass) once; with recording off they only pass through (`fetchWrapper.ts`, `xhrWrapper.ts`, `wsWrapper.ts`).
- Data: `recorder.ts` (flag plus `ringBuffer.ts`, 5000 entries, raw values) with entry types in `types.ts`: `http` (fetch/xhr), `ws` (connection events and frames, linked by connection id) and `resource` (PerformanceObserver, `resources.ts`, for img/video/iframes). `summarize.ts` builds body summaries and previews. `redact.ts` hides secrets (session tokens, auth headers, token query params, password/token JSON fields, whole auth/MFA bodies) when entries are read, not when stored.
- `state.ts` is the reactive Solid API (`recording()`, `setRecording()`, `entries()`, `clear()`). In dev builds it is also on `window.__anytalkTraffic`.
- Call data (chunk 2): `callTraffic.ts` (`monitorCall`, exposed as `watchCallTraffic` in `state.ts`) is started in `rtc/state.tsx` just before `room.connect` and stopped in `#teardown`. It wraps the local participant's `publishData` and `setAttributes` once (so the E2EE key exchange, `StreamViewers`, deafen and follow all show up without touching call sites) and listens to `dataReceived`. Every 5 s while recording it reads `engine.pcManager.publisher/subscriber.getStats()` (private LiveKit API, all guarded) and records `call-info` (room, SFU URL, E2EE on or off), `call-connection` (selected ICE pair, relay or direct, remote address, DTLS/SRTP ciphers, only when the path changes), `call-bytes` (per-track byte counts, only when they changed), `call-data` and `call-attribute`. `redact.ts` hides the wrapped key (`ct`, `iv`) in `anytalk:e2ee` messages; the hello's public keys stay visible. `CALL_ENCRYPTION_EXPLANATION` describes the double encryption (E2EE inside SRTP/DTLS) for the later UI.
- Not recorded: the media packets themselves (LiveKit RTP), push delivery, service worker fetches, anything outside the page's JS. Coming: a settings page with a live view, and desktop extras (TLS key log, Electron webRequest).

### PWA and notifications
- `src/serviceWorker.ts`, `src/serviceWorkerInterface.ts` (vite-plugin-pwa, set up in `vite.config.ts`). A pending update is activated from the update notice, so deploys don't need a hard reload. Doesn't run over the plain-http phone link.
- `src/updateCheck.ts`: the home page notice for a new web build. It compares the hashed entry script of the served page with the running one (no notice on the dev server). The notice can be hidden under Advanced settings. The desktop app polls for new builds the same way.

## What AnyTalk changed compared to upstream Stoat

There's no upstream remote. The fork carries its own commits on top of Stoat's history, plus some picked-up upstream PRs (emoji renaming, GIF search, server folders, channel reordering, accessibility). Main themes:

- **Calls/RTC** (`components/rtc`, `ui/components/features/voice`): RNNoise v3 with a speech gate and low-cut filter, a stream quality picker (1080p60/1440p60) with a confirm step before sharing, fullscreen focused streams, speaking indicator timing, a developer mode with call stats and recaps (comparison and export), LiveKit adaptiveStream and dynacast, the livekit-client patch, automatic reconnect and rejoin after a network drop, and a call footer with mic/speaker picker and iPhone loudspeaker/earpiece switch.
- **Connection**: the app reconnects when the network or the tab comes back (`components/client/lifecycleWake.ts`).
- **Mobile/iOS**: safe areas (rounded corners, home indicator), call controls and tiles on small screens, Safari audio unlock and volume fixes, settings as a mobile list, fullscreen video.
- **Sound**: message bell, ringtones, notification volumes, vibration on incoming calls (`Sounds` store, SoundController).
- **i18n**: fork-maintained translations (de, fr, es, ja, ko, zh-Hans, ar), right-to-left mirroring, language switching without a full reload.
- **UI**: settings icons, creating channels from a category header, voice channel drag and drop (desktop), language search in the picker.
- **Input**: game controller support (`components/gamepad`, see Game controller), keyboard use of context menus, and push to talk for keys and controller (see Voice, calls and screen share). Windows global hotkeys use a passive keyboard hook, so releases work.
- **Desktop app**: Electron wrapper with its own updater and a "Restart to update" item (see Desktop shell). Game stream detection with follow mode and a stream hotkey (see Stream your game).
- **Performance**: lazy code highlighting, outlined icon font only.
- **Build/branding**: renamed from Stoat to AnyTalk, a single GHCR image with runtime config injection, a fixed dev port reachable from the LAN.

## Where to start for common changes

| Change | Start in | Usually also touches |
|---|---|---|
| New persisted preference | `components/state/stores/` (new key or store) | a user settings page, `doc/src/components/state/creating.md` |
| New settings page | `components/app/interface/settings/UserSettings.tsx` (or the Server/Channel config) | the store it edits |
| New dialog | `components/modal/types.ts`, `modals.tsx`, `modals/` | the menu or button that opens it |
| New route or screen | `src/index.tsx`, `src/interface/` | `components/routing`, `Layout` store |
| Message rendering | `components/app/interface/channels/text/Message.tsx`, `ui/.../messaging/elements/` | `components/markdown` |
| Composer behaviour | `ui/.../messaging/composition/MessageBox.tsx` | `Draft` store |
| Call behaviour or audio | `components/rtc/state.tsx`, `VoiceProcessor.ts` | `Voice` store, `ui/.../features/voice/` |
| Call layout or tiles | `ui/components/features/voice/callCard/` | `rtc/state.tsx` (layout, focus) |
| Call footer or device picker | `ui/components/features/voice/callCard/VoiceStatusFooter.tsx`, `AudioDeviceMenu.tsx` | `rtc/state.tsx` (`setAudioOutput`, `setAudioInput`) |
| Overlay look, position or rules | `packages/desktop/src/overlay/`, `src/main/overlay.ts` | `rtc/components/OverlayPublisher.tsx`, `rtc/overlayConfig.ts`, `settings/user/Overlay.tsx` |
| Game detection or game stream follow | `packages/desktop/src/main/games.ts`, `gameMatch.ts`, `rtc/gameFollow.ts` | `shared/games.ts` (game list), `main/screen.ts`, `rtc/state.tsx` (`startGameStream`), `rtc/focusedGame.ts` (hotkey), `rtc/streamFollow.ts` (viewers) |
| Push to talk (mode, release delay, sources) | `components/rtc/pushToTalk.ts`, `rtc/state.tsx` (`pushToTalk`, `syncMicrophone`) | `keybinds/keybindHandler.tsx` (release callbacks), `GlobalKeybinds.tsx`, `Voice` store |
| Global hotkey or key matching | `packages/desktop/src/main/hotkeys.ts`, `hotkeyHook.ts`, `hotkeyKeys.ts` | `keybinds/GlobalKeybinds.tsx` (renderer side), `keybinds/keyCodes.ts`, `shared/ipc.ts` |
| Controller push to talk (button, XInput) | `packages/desktop/src/main/gamepad.ts`, `gamepadLogic.ts` | `gamepad/pushToTalkButton.ts`, `gamepad/input.ts` (`maskButton`), `settings/user/Controller.tsx` |
| Controller button layout or rebinding | `components/gamepad/bindings.ts`, `gamepad/capture.ts` | `gamepad/GamepadControls.tsx` (action switch), `settings/user/Controller.tsx`, `Settings` store (`controller:bindings`) |
| Reconnect or rejoin after a drop | `components/rtc/reconnect.ts`, `rtc/state.tsx` | `components/client/lifecycleWake.ts` (app-level wake handling) |
| Sounds | `@revolt/client` SoundController | `Sounds` store, sound settings page |
| Context menu entry | `components/app/menus/` | a modal, if the entry opens one |

Any new user-facing text needs `mise lingui` and the `translator` afterwards. Calls and iOS behaviour need a real device test.

## Existing docs (don't repeat them here)

- `doc/src/` (mdbook): `hello.md`, `feature-matrix.md`, `components/client/` (session lifecycle, user limits), `components/state/`, `components/modal/guidelines.md`, `components/i18n/`, `components/ui/`, `responsive/` (device, feature detection), `user-interface/` (icons, text channels, navigation). `contribution-guide.md` is upstream's and doesn't apply here.
- `docs/bugs/` (repo root): debugging notes for open bugs, e.g. `stuck-navigation.md`.
- `GUIDELINES.md` (code rules), `packages/client/components/ui/DESIGN.md` (UI design), `CHANGELOG.md`, `README.md` (setup and deployment overview).
- `docs/wiki/`: user, self-hosting, backend and developer docs, published to the GitHub wiki by `.github/workflows/wiki.yml`.

## Desktop shell (`packages/desktop`)

Electron app for Windows and Linux that loads the hosted AnyTalk server in a window; it does not depend on the client build. `src/main` holds the main process (window, tray, config in userData, autostart, global hotkeys, screen-share handler with its one-shot preselection, game detection in `games.ts` and `gameMatch.ts`, permissions, error page routing), `src/preload` exposes `window.native` / `window.desktopConfig` to the page only on the server origin, and `src/error-page` is the offline fallback page. The default server URL is baked in at build time from `ANYTALK_DEFAULT_URL` (`scripts/build.mjs`); `ANYTALK_URL` overrides at runtime. Mise tasks: `desktop:dev`, `desktop:build`, `desktop:build:win`, `desktop:build:win:zip`; cross-built Windows exes get their icon and version info from `scripts/afterPack.mjs` (resedit) since rcedit needs Wine; CI in `.github/workflows/desktop.yml` (a `desktop-v<version>` tag publishes to GitHub Releases). `src/main/updater.ts` self-updates NSIS and AppImage installs from those releases through electron-updater (bundled into `dist/main.js`); deb, rpm, pacman and dev runs skip it. Once an update is downloaded, the tray and File menus get a "Restart to update" item (the app normally stays in the tray). The updater is an explicit state machine (`UpdaterState` in `src/shared/ipc.ts`) broadcast to the page as `window.desktopUpdater` (`getState`, `check`, `download`, `install`, `onState`); the `autoUpdate` config key (default on, client-writable) controls auto-download and install-on-quit live. Downloads are only marked ready after an ed25519 signature check (`updateSignature.ts`, trusted keys in `trustedUpdateKeys.ts`, `<installer>.sig` release assets made by `scripts/sign-release.mjs`); see `packages/desktop/RELEASING.md`.

Global input has two parts. Keyboard hotkeys: `src/main/hotkeys.ts` is the facade. On Windows it uses `hotkeyHook.ts`, a passive `uiohook-napi` keyboard hook that reports press and release without swallowing keys (so another app can use the same combo). Other platforms use Electron `globalShortcut`, which only reports presses. `hotkeyKeys.ts` (pure, tested) parses accelerators and matches key events, and prefers each binding's physical `code` over the typed character. IPC `hotkeys:released` and `hotkeys:capabilities` tell the page whether releases arrive. Controller push to talk on Windows: `gamepad.ts` polls XInput through `koffi` only while a button is set, and `gamepadLogic.ts` (pure, tested) holds the button map, trigger hysteresis and edge detection. IPC `gamepad:set` (page to shell) and `gamepad:ptt` (shell to page) carry the presses. Both native modules (`uiohook-napi`, `koffi`) are external in the esbuild bundle, unpacked from asar, and not rebuilt (`npmRebuild: false`).

The app id is `tech.anyportal.AnyTalk` (`APP_ID` in `src/main/platform.ts`, also the electron-builder `appId` and `desktopName`). On Wayland, Chromium's global shortcuts go through the xdg GlobalShortcuts portal, which refuses apps without a valid reverse-DNS id and a matching `<appId>.desktop` file. Packages install that file themselves; `src/main/desktopFile.ts` writes one to `~/.local/share/applications` for AppImage and dev runs. `hotkeys.ts` only applies the difference between binding sets, since every change recreates the portal session. The client gets `window.native.desktopEnvironment` to show Hyprland-specific setup help (Hyprland needs the `global` dispatcher bound by the user).
