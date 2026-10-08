/**
 * Matches the entry script of a built page, e.g. `/assets/index-AbC123.js`
 */
const ENTRY_SCRIPT = /\/assets\/index-[\w-]+\.js/;

/**
 * Find the entry script (the hashed `/assets/index-*.js` file) in the HTML
 * of a page. The hash changes with every deploy, so it identifies the build.
 *
 * @param html Page source
 * @returns The script path, or undefined when there is none (dev server)
 */
export function findEntryScript(html: string): string | undefined {
  return ENTRY_SCRIPT.exec(html)?.[0];
}

/**
 * Whether the server now serves a different build than the one running.
 * Unknown on either side (dev server, odd response) counts as no update, so
 * the notice never shows by mistake.
 *
 * @param current Entry script the running page loaded
 * @param latest Entry script of the page the server serves now
 */
export function isNewBuild(
  current: string | undefined,
  latest: string | undefined,
): boolean {
  return !!current && !!latest && current !== latest;
}
