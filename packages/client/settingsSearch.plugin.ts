import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Collects the texts of each user settings page, so searching the settings
 * also finds what is on a page and not just its name
 *
 * import pages from "virtual:settings-search" gives, by page id, every
 * <Trans> and t`` text (and untranslated text and title, description and
 * label attributes) in the page's file and the files it imports from the
 * same folder, as lingui messages to translate at runtime
 */

const MODULE_ID = "virtual:settings-search";
const RESOLVED_ID = "\0" + MODULE_ID;

const ROOT = resolve("./components/app/interface/settings/user");

/**
 * Page id to the file rendering it, as in UserSettings.tsx
 */
const PAGES: Record<string, string> = {
  account: "Account.tsx",
  profile: "profile/index.ts",
  sessions: "Sessions.tsx",
  bots: "bots/index.ts",
  voice: "voice/VoiceSettings.tsx",
  appearance: "appearance/index.ts",
  notifications: "notifications/Notifications.tsx",
  keybinds: "Hotkeys.tsx",
  controller: "Controller.tsx",
  language: "Language.tsx",
  native: "Native.tsx",
  "desktop-download": "DesktopDownload.tsx",
  advanced: "Advanced.tsx",
  developer: "developer/Developer.tsx",
};

const importRegex = /from\s+["'](\.{1,2}\/[^"']+)["']/g;
const transRegex = /<Trans>([^<>{}]+)<\/Trans>/g;
const tRegex = /\bt`([^`$]+)`/g;
// untranslated text, e.g. on the developer pages
const textRegex = />\s*([A-Za-z][^<>{}]*[A-Za-z.?!)])\s*</g;
const attributeRegex = /\b(?:title|description|label)="([^"]+)"/g;

/**
 * Lingui's message id, see @lingui/message-utils generateMessageId
 */
function messageId(message: string) {
  return createHash("sha256")
    .update(message + "\u001F")
    .digest("base64url")
    .slice(0, 6);
}

/**
 * Find the file an import points to
 */
function resolveImport(from: string, specifier: string) {
  const base = resolve(dirname(from), specifier);
  for (const path of [
    base,
    base + ".tsx",
    base + ".ts",
    base + "/index.tsx",
    base + "/index.ts",
  ])
    if (existsSync(path) && statSync(path).isFile()) return path;
}

/**
 * Texts of a page's file and the files it imports from the same folder
 */
function collect(entry: string, watch: Set<string>) {
  const messages = new Map<string, string>();
  const files = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    watch.add(file);

    const src = readFileSync(file, "utf-8");

    for (const [, specifier] of src.matchAll(importRegex)) {
      const path = resolveImport(file, specifier);
      if (path?.startsWith(ROOT + "/")) queue.push(path);
    }

    for (const [, text] of src.matchAll(transRegex)) {
      // JSX joins the lines of a text with single spaces
      const message = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");
      if (message.length > 2) messages.set(messageId(message), message);
    }

    for (const [, message] of src.matchAll(tRegex))
      if (message.length > 2) messages.set(messageId(message), message);

    for (const regex of [textRegex, attributeRegex])
      for (const [, text] of src.matchAll(regex)) {
        const message = text.replace(/\s+/g, " ").trim();
        // material symbol names like screen_share aren't text
        if (message.length > 2 && !/^[a-z_]+$/.test(message))
          messages.set(messageId(message), message);
      }
  }

  return [...messages].map(([id, message]) => ({ id, message }));
}

export default function settingsSearchPlugin() {
  return {
    name: "settings-search",
    resolveId(id: string) {
      if (id === MODULE_ID) return RESOLVED_ID;
    },
    load(this: { addWatchFile(file: string): void }, id: string) {
      if (id !== RESOLVED_ID) return;

      const files = new Set<string>();
      const pages = Object.fromEntries(
        Object.entries(PAGES).map(([page, file]) => [
          page,
          collect(resolve(ROOT, file), files),
        ]),
      );

      // rebuild when a page changes during development
      for (const file of files) this.addWatchFile(file);

      return `export default ${JSON.stringify(pages)};`;
    },
  };
}
