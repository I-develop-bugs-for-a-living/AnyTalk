# AnyTalk

AnyTalk is a personal fork of the Stoat web client (stoatchat/for-web). Changes stay in this fork and are not sent upstream, so ignore Stoat's contribution process, PR template and LLM-usage declaration.

Stack: pnpm monorepo, SolidJS, PandaCSS, Lingui (i18n), LiveKit (voice/video), Vitest, Playwright. Tasks run through mise.

## Layout

- `packages/client`: the app. All regular work happens here.
  - `components/*` are imported through the `@revolt/*` aliases (`@revolt/ui`, `@revolt/rtc`, `@revolt/state`, ...), see `packages/client/tsconfig.json`.
  - `components/app/interface`: screens (channels, settings, ...).
  - `components/ui`: shared UI components, themes and directives.
  - `components/rtc`: calls, screen sharing, noise suppression, LiveKit state.
  - `components/state/stores`: persisted client state.
  - `components/i18n/catalogs`: generated translation catalogs.
- `packages/stoat.js`, `packages/solid-livekit-components`: git submodules (upstream code). Don't edit them unless asked. After changing them, rebuild with `mise build:deps`.
- `packages/client/assets`: private submodule, may be missing. `mise dev` falls back automatically.
- `patches/livekit-client.patch`: pnpm patch applied to livekit-client.
- `../AnyTalk-Server` (separate repo, github.com/Neparshath-coder/anytalk-server): builds the patched Stoat api image the server runs. It's what lets participants send LiveKit data messages (stream viewers) and set their own attributes (deafen state). When a call feature fails because the server rejects it (token grants, permissions), the fix belongs there, not here. See its CLAUDE.md.
- `TODO.md`, `NOTES`: local notes for open work (`TODO.md` is git-excluded).

Before planning a feature, read ARCHITECTURE.md in the repo root. It maps the feature areas, their key files and how data flows through the app. It's committed like this file. When a change adds, moves or removes a feature area, update ARCHITECTURE.md in the same task and commit it with that change (or as `docs: update architecture map` after a map-keeper run).

This file, ARCHITECTURE.md, `.claude/` (agents, scripts, shared settings) and `packages/client/components/ui/DESIGN.md` are in the public repo. Keep secrets, credentials, test account data and unfixed security findings out of them. Personal settings go in `.claude/settings.local.json` (gitignored). Open security work stays in `TODO.md`.

When a README, wiki page or other committed doc links to a file, that file must be committed too. Check with `git ls-files --error-unmatch <path>`.

A SessionStart hook runs `.claude/scripts/check-architecture.mjs`, which stays silent while the map is current. When it reports drift, start the `map-keeper` agent in the background with the report and tell the user in one line. The main session never updates the map itself. Read ARCHITECTURE.md only when planning (don't import it with `@`, it must not load automatically).

## Commands

Everyday checks after a change (run these, in this order):

```bash
mise lint            # eslint (mise lint:fix to auto-fix)
mise build:check     # tsc --noEmit
mise test:unit       # vitest
mise format          # prettier check (mise format:fix to fix)
```

If `mise` isn't installed (`command -v mise` finds nothing), run the same commands directly from the repo root:

| mise | pnpm equivalent |
|---|---|
| `mise lint` / `lint:fix` | `pnpm exec eslint [--fix] --ext .ts,.tsx packages/client` |
| `mise build:check` | `pnpm --filter client exec tsc --noEmit` |
| `mise test:unit` | `pnpm --filter client run test:unit` |
| `mise format` / `format:fix` | `pnpm exec prettier [--check / --write] 'packages/client/**/*.{ts,tsx,json}'` |
| `mise lingui` | `pnpm --filter client exec lingui extract` then `pnpm --filter client exec lingui compile --typescript` |
| `mise dev` | `pnpm --filter client exec node scripts/copyAssets.mjs` once, then `pnpm --filter client exec vite` |

- Don't run `mise check` unless asked: it reinstalls dependencies and runs the Playwright e2e suite, which is slow.
- There are few unit tests, so lint and the type check are the main safety net. Add a `*.test.ts` next to pure logic you write (see `components/rtc/*.test.ts`).
- Use `pnpm` (never npm or yarn). Run client scripts with `pnpm --filter client ...`.

## Test server

The user tests every change on desktop and on a phone in the same network. **After changing anything in the app, make sure the dev server is running and give the user the links.** This is the main session's job, not the subagents'.

1. Check whether it's already running: `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` (200 means yes). Vite reloads changes on its own, so a running server doesn't need a restart. Never start a second one.
2. If it's not running, start it with `mise dev`. `vite.config.ts` fixes it to port 5173 on all network interfaces, so the links stay the same. Start it in a visible terminal tab if one is available (it keeps running after the session ends and the user can see its output). Otherwise run it as a background process. If port 5173 is taken by something else, tell the user instead of switching ports.
3. Wait until it answers, then check the server output for errors.
4. Tell the user both links:
   - Desktop: http://localhost:5173
   - Phone (same Wi-Fi): `http://<LAN IP>:5173`, with the LAN IP from `ip -4 -o addr show scope global` (the `Network:` line in Vite's output shows it too)
5. Say what to test, on which device, and anything that only works on one of them.

Restart the server only when it's needed: after changing `vite.config.ts`, `.env`, `panda.config.ts`, dependencies, or rebuilding `stoat.js`.

Limits of the phone link:

- It's plain `http`, which browsers treat as insecure on any address other than localhost. **Microphone, camera, screen sharing and the service worker don't work on the phone link**, so voice calls can't be tested there. Point this out when a change touches calls or media, instead of letting the user find out.
- The firewall (ufw) has to allow port 5173 from the local network. If the phone can't connect, that's the first thing to check. Changing firewall rules is the user's decision, so suggest the command (`sudo ufw allow from 192.168.178.0/24 to any port 5173 proto tcp`) and let them run it.

## Code rules

These come from `GUIDELINES.md`:

- **Never destructure Solid props.** Use `splitProps`, or access `props.x` directly. Destructuring breaks reactivity.
- Add a doc comment above every component, function, class, constant and non-overriding method (JSDoc style, see existing files). Explain longer logic inline.
- Accessibility: use semantic HTML, aria labels where needed, and support keyboard navigation and screen readers.
- Import an external library in one place and re-export it, instead of importing it across many components.
- Use type-only imports where a package only needs types (e.g. `stoat.js` in `@revolt/ui`).
- 2-space indent, prettier formatting with organized imports.
- `solid-js` is pinned to 1.9.14 in `pnpm-workspace.yaml` (newer versions break reactivity). Don't bump it.

## UI design

Before designing or building UI, read `packages/client/components/ui/DESIGN.md` (colors, components to reuse, empty states, mobile, accessibility, text length and right-to-left).

Design work (deciding how something should look) happens in the main session with the user: look at it in the browser pane at desktop and phone width, agree on the look, then hand the build to `coder`.

## i18n

- Wrap all user-facing text in Lingui macros from `@lingui/solid/macro`: `<Trans>` in JSX, and `const { t } = useLingui()` for strings in code.
- Don't edit `components/i18n/catalogs` by hand. Regenerate with `mise lingui` and commit catalog changes separately as `chore: extract i18n catalogs`.
- Main languages kept complete in this fork: German, French, Spanish, Japanese, Korean, Simplified Chinese, Arabic. The `translator` agent fills in missing strings with `packages/client/scripts/po-untranslated.mjs`. It can also do every other language in the language setting when asked, except the encoded joke languages (`bottom`, `enchantment`, `leet`, `piglatin`) and `en`, `dev`. After `mise lingui`, refill those four with `node scripts/po-encode.mjs` (in `packages/client`).

## Testing limits

A lot of recent work is in calls and on mobile (iPhone Safari, safe areas, small screens). Type checks can't confirm that these work. Say clearly what still needs to be tried in a real call or on a real device, and don't claim it works.

## Subagents

The main session plans, decides and talks to the user. The agents in `.claude/agents/` do the reading and the work, on cheaper models:

- `explorer` (Haiku, strictly read-only: Read, Grep, Glob, no shell): cheap lookups. "Where is X", "which files handle Y", "which files would a change touch". Not for explaining logic or bugs. It can't run git, so send git history questions to `git-helper` or `investigator`.
- `investigator` (Sonnet, read-only, with a read-only shell): "how does X work" and "why is X broken". Traces logic across files and finds root causes, and reaches what the explorer can't: `node_modules` and library sources, submodules, git history, `gh search code`, and GET requests to the deployed server. Returns the cause and a proposed fix.
- `coder` (Sonnet): implementation. Give it a clear task: what to change, which files or areas, and what "done" looks like. Split big features into self-contained chunks. For a small bug, give it the symptom directly: it finds the cause itself, so don't run an explorer or investigator first.
- `reviewer` (Sonnet, read-only): review the code diff before committing. Not for translations.
- `translator` (Sonnet): fills in missing translations. Run it after new user-facing text was added (after `mise lingui` extracted it). It checks placeholders, tags and plurals itself with `node scripts/po-untranslated.mjs check <locale>`.
- `translation-reviewer` (Sonnet, read-only): checks meaning, terms and tone of new translations. Use it only for the main languages, or another language when the user asks. Skip it for joke languages and for a handful of strings. Pass its "must change" entries back to the translator with SendMessage.
- `git-helper` (Sonnet): commits, branch syncing, git-town, and git history lookups (log, blame, what changed when). For a plain "commit these files" task, pass `model: "haiku"`. Keep Sonnet for splitting changes into several commits, pushing, and git-town.
- `map-keeper` (Haiku): keeps ARCHITECTURE.md current from the drift report and the git changes since its last update. Edits only that file.
- `security-auditor` (Opus): finds exploitable security flaws in the client and `../AnyTalk-Server` and checks each one with a test. Expensive, so only for occasional audits (e.g. before a release to `main`) or a focused audit of one area, not after every change. It tests live only against the local Docker stack in `~/Github/AnyPortal_Apps/self-hosted` (accounts in `test-accounts.json` there; the agent file has the details). Never point it at production.

### Don't read code in the main session

The main session costs the most per token, and everything it reads stays in its context for the rest of the conversation. So:

- **Delegate code reading.** Before planning a change, send the question to `explorer` (where) or `investigator` (how or why) and work from its summary. If its report isn't enough to act on, ask it a follow-up with SendMessage instead of reading the code yourself. Don't read source files, grep across folders or dump diffs yourself.
- **Allowed directly:** one or two small, already-known files (or a few lines of one) to settle a specific detail, CLAUDE.md and DESIGN.md, and short command output (`git status --short`, check results).
- **Don't pre-read for the coder.** The `coder` reads the files it needs itself. Give it the goal, the area (from the explorer's summary) and the constraints, not file contents.
- **Don't re-read the agents' work.** Trust their reports. For a closer look at a change, send the `reviewer`.
- Run independent agents in parallel (e.g. `explorer` questions about two areas, or `translator` while `reviewer` checks the code).

Do small edits (a few lines in a known file) and anything needing back-and-forth with the user directly. Typical flow for a feature: `explorer` or `investigator`, then plan with the user, then `coder`, then `reviewer`, then fixes (SendMessage to the same coder), then `translator` if text changed (plus `translation-reviewer` for the main languages), then `git-helper`. For a small bug: `coder` with the symptom, then `reviewer`, then `git-helper`.

### Keep translation catalogs out of context

`packages/client/components/i18n/catalogs` holds about 15 MB of generated text (69 languages). Only the `translator` works with it, through `packages/client/scripts/po-untranslated.mjs`.

- Grep, Glob and `rg` skip it automatically (`.ignore`). With `grep -r`, add `--exclude-dir=catalogs`.
- To find UI text, search the source for the English string, not the catalogs.
- Keep `git status` and `git diff` output short: exclude the catalogs with `-- . ':!packages/client/components/i18n/catalogs'`, and count them instead of listing them (`git status --short -- packages/client/components/i18n/catalogs | wc -l`).
- Pipe `mise lingui` output through `tail -3`: the full table lists all 69 languages.

## Git

- Branches: `Development` is the working branch, `main` is the release branch. Pushing to `main` builds and publishes the Docker image (`.github/workflows/docker.yml`).
- git-town is configured (`git-town.toml`).
- Conventional commits, with the subject describing the change from the user's point of view, in present tense and lower case:
  - `fix: call tiles no longer flicker after closing a focused stream`
  - `feat: create channels from a category's header`
  - `perf: load only the outlined icon font`
- One logical change per commit. Keep generated catalog updates in their own commit.
- Never commit `.env` files or touch submodule pointers unless asked.
