declare module "virtual:settings-search" {
  /**
   * Texts on each user settings page by page id, see settingsSearch.plugin.ts
   */
  const pages: Record<string, { id: string; message: string }[]>;
  export default pages;
}
