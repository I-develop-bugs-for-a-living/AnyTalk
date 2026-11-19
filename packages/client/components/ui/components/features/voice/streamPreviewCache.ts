/** How long a fetched preview is reused, in milliseconds */
export const PREVIEW_CACHE_MS = 2 * 60 * 1000;

/** How long a missing preview (404, error) is remembered, in milliseconds */
export const PREVIEW_MISS_MS = 15 * 1000;

/** Result of a preview lookup: an object URL, or undefined without preview */
export type PreviewResult = string | undefined;

type Entry = { at: number; result: PreviewResult };

/**
 * Cache for stream previews per channel and user. Object URLs of replaced
 * entries are revoked.
 * @param now Clock, replaceable for tests
 * @param revoke Releases an object URL
 */
export function createPreviewCache(
  now: () => number = Date.now,
  revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
) {
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<PreviewResult>>();

  return {
    /**
     * Get a preview, from the cache while it is fresh
     * @param channelId Channel of the call
     * @param userId Streaming user
     * @param load Loads the preview, resolving to undefined when none exists
     */
    get(
      channelId: string,
      userId: string,
      load: () => Promise<PreviewResult>,
    ): Promise<PreviewResult> {
      const key = `${channelId}/${userId}`;
      const hit = entries.get(key);
      if (
        hit &&
        now() - hit.at < (hit.result ? PREVIEW_CACHE_MS : PREVIEW_MISS_MS)
      ) {
        return Promise.resolve(hit.result);
      }

      const running = pending.get(key);
      if (running) return running;

      const request = load()
        .catch(() => undefined)
        .then((result) => {
          // the old image may still be on screen, so it's released only
          // when it is replaced
          if (hit?.result) revoke(hit.result);
          entries.set(key, { at: now(), result });
          return result;
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },

    /** Drop everything and release all object URLs */
    clear() {
      for (const entry of entries.values()) {
        if (entry.result) revoke(entry.result);
      }
      entries.clear();
    },
  };
}
