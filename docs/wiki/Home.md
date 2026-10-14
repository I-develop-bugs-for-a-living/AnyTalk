# AnyTalk

AnyTalk is a chat and voice app for self-hosted servers. It's built on [Stoat](https://stoat.chat) (formerly Revolt): servers, channels, roles, direct messages and friends work like there, and AnyTalk adds better calls and screen sharing, iPhone support, a desktop app with game streaming and an in-game overlay, and controller support.

AnyTalk has three parts:

| Part | What it is | Where |
|---|---|---|
| **Web app** | The app in the browser, also installable as a PWA | [AnyTalk](https://github.com/I-develop-bugs-for-a-living/AnyTalk) (`packages/client`) |
| **Desktop app** | Windows and Linux app with global hotkeys, game streaming and overlay | [AnyTalk](https://github.com/I-develop-bugs-for-a-living/AnyTalk) (`packages/desktop`) |
| **Backend** | Stoat's server, with a patched api for some call features | [anytalk-server](https://github.com/Neparshath-coder/anytalk-server) |

## For users

- [Features](Features): calls, screen sharing, shortcuts, controller, settings
- [Desktop App](Desktop-App): download, updates, game streaming, overlay, hotkeys
- [Troubleshooting](Troubleshooting)

## For server owners

- [Self-Hosting](Self-Hosting): set up your own AnyTalk server, step by step
- [Configuration](Configuration): web app variables, `Revolt.toml`, LiveKit
- [Backend](Backend): what the patched api changes and how it's built

## For developers

- [Development](Development): code layout, setup, checks, translations, releases
- [Changes from Stoat](Changes-from-Stoat): everything that differs from upstream

## License

AnyTalk is licensed under the [GNU Affero General Public License v3.0](https://github.com/I-develop-bugs-for-a-living/AnyTalk/blob/main/LICENSE), like Stoat. If you run a modified version for others, the AGPL requires you to offer them its source code.
