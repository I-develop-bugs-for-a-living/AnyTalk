# Stuck navigation after leaving a call / switching servers

Status: guarded on 2026-10-08, not confirmed fixed (happens only sometimes).
Seen on the live web build (chat.any-portal.tech), not in the desktop app so far.

## Symptoms

- Clicking Home or another server does nothing. The server description tooltip
  still appears, but no new console output when clicking.
- The server rail renders garbled: icons and names of servers overlap.
- The address bar and the screen disagree. In the recorded case the URL pointed
  to the Test server's voice channel `Test` (`/server/01M34MGC337WBG0J9H5Y1YKVMD/channel/01M34MJ0ZRQAR20WKQMN5WHVRR`),
  while the channel header still showed `Talkie1` and the sidebar showed the
  Test server's channels.

## How it happened

1. Join a voice channel on the Test server, leave it (`[rtc] filtered tracks Array(0)`).
2. Try to open another server (MöwenDiscord).
3. Rejoin/leave the call a couple of times; the websocket also dropped and reconnected.

## Console errors (in order)

```
Uncaught TypeError: Cannot read properties of undefined (reading 'member')   at get member  (via floating.ts)
Uncaught TypeError: Cannot read properties of undefined (reading 'mature')   at get enabled -> get when
Uncaught TypeError: Cannot read properties of undefined (reading 'id')       from a document event handler
Uncaught TypeError: Cannot read properties of undefined (reading 'unread')   from a document event handler
```

The first one appeared right after the call ended. Source-mapped line numbers
in the production build are off (frames show up as `keep.svg:1`, and
`floating.ts:379` is only an effect cleanup), so treat file/line hints as
approximate.

Unrelated noise in the same log: `Could not share deafen state` (server-side
permission, see AnyTalk-Server), `Unhandled 'error' event` from the websocket
on reconnect, and "Uncompiled message detected" warnings (stale catalogs).

## Explanation (not proven)

While leaving a call or switching servers, the current server or channel
briefly resolves to `undefined` (`client.servers.get(...)` /
`client.channels.get(...)`). Several places used `!` and read from it anyway:

| Error    | Where                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| `member` | `FloatingManager.tsx`: `props.show()!.userCard!.member` after `show` changed kind        |
| `mature` | `ChannelPage.tsx`: `channel().mature` passed to `AgeGate`                                |
| `id`     | `ServerSidebar.tsx`: channel up/down keybind reading `props.server.id`                   |
| `unread` | `ServerSidebar.tsx` mark-server-read keybind, `TextChannel.tsx` jump-to-end keybind     |

A throw inside a Solid update aborts the rest of that update, so the router
and sidebar are left half-updated: the URL changes, the screen does not.

## What was changed

- `ChannelPage.tsx`: channel is `Channel | undefined`; the text channel is
  rendered inside a non-keyed `<Show when={channel()}>`. Keep it non-keyed:
  keyed remounts `TextChannel` on every channel switch (flicker, call card
  jumps, member re-sync).
- `FloatingManager.tsx`: Match branches are keyed and use the callback value.
- `ServerSidebar.tsx`, `Sidebar.tsx`, `TextChannel.tsx`: keybinds and handlers
  bail out when the server/channel is missing.
- `VoiceChannelPreview.tsx`: no user card / context menu for uncached users.
- `CategoryContextMenu.tsx`: `channel?.unread`.

## If it comes back

1. Copy the full console log, especially the first `Uncaught TypeError` and
   what was logged right before it.
2. In the stuck tab, check whether clicking Home changes the URL.
   - URL changes, screen doesn't: another unguarded read crashed an update.
     Look for the property name in the error and search for `!`-asserted
     `servers.get` / `channels.get` / `props.server.` / `props.channel.` reads.
   - URL doesn't change: the click is lost; look at the server rail
     (`ServerList.tsx`, `railDrag.ts`) and floating/overlay elements covering it.
3. Still unguarded but considered safe today: other `props.server.*` reads in
   `ServerSidebar.tsx` and `props.channel.*` reads in `TextChannel.tsx`. They
   rely on the parent `<Show>` / `<Switch>` order. Check those first.
4. A local build with `build.sourcemap` set to true gives exact lines;
   the published build's maps are misaligned.
