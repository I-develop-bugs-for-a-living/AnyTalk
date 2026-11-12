/**
 * A screen or window offered in the screen share picker. Must match
 * `PickerSource` in `packages/desktop/src/shared/ipc.ts`.
 */
export type PickerSourceItem = {
  idx: number;
  name: string;
  isFullScreen: boolean;
  image?: string;
};

/**
 * Merge a freshly fetched source list into the one on screen. Sources are
 * matched by `idx`, which the desktop app keeps stable per window. Unchanged
 * sources keep their object (so their tiles aren't recreated) and their
 * place in the list, new ones are appended. A source missing from `next`
 * (e.g. a borderless window that just lost focus) is kept with its last
 * known name, thumbnail and `idx`, so it stays selectable and still starts
 * a capture for the right window if the user picks it.
 *
 * @param prev List currently shown
 * @param next Freshly fetched list
 * @param hasThumbnails Whether `next` carries real thumbnails. When it
 * doesn't, its images are only app icons, so existing images are kept.
 * @returns The merged list, `prev` itself when nothing changed
 */
export function mergeSources(
  prev: PickerSourceItem[],
  next: PickerSourceItem[],
  hasThumbnails: boolean,
): PickerSourceItem[] {
  const incoming = new Map(next.map((source) => [source.idx, source]));
  const result: PickerSourceItem[] = [];

  for (const old of prev) {
    const fresh = incoming.get(old.idx);
    if (!fresh) {
      // Not seen in this poll, keep it as it was so it stays selectable
      result.push(old);
      continue;
    }
    incoming.delete(old.idx);

    const image = hasThumbnails ? fresh.image : (old.image ?? fresh.image);
    result.push(
      old.name === fresh.name &&
        old.isFullScreen === fresh.isFullScreen &&
        old.image === image
        ? old
        : { ...fresh, image },
    );
  }
  result.push(...incoming.values());

  const same =
    result.length === prev.length &&
    result.every((source, i) => source === prev[i]);
  return same ? prev : result;
}
