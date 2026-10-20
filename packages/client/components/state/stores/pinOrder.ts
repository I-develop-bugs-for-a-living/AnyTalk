/**
 * Clean a stored list of pinned conversation IDs: keep only non-empty
 * strings and drop duplicates, keeping the first occurrence
 * @param input Stored value
 * @returns List of IDs in pin order
 */
export function cleanPinnedIds(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const id of Array.isArray(input) ? input : []) {
    if (typeof id === "string" && id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }

  return out;
}

/**
 * Put pinned conversations first, in pin order, followed by the rest in their
 * existing order. IDs which match no conversation are ignored.
 * @param conversations Conversations in their normal order
 * @param pinnedIds Pinned IDs, oldest pin first
 * @returns The pinned group and the remaining conversations
 */
export function splitPinned<T extends { id: string }>(
  conversations: T[],
  pinnedIds: string[],
): { pinned: T[]; rest: T[] } {
  const byId = new Map(conversations.map((c) => [c.id, c] as const));
  const pinned: T[] = [];
  const taken = new Set<string>();

  for (const id of pinnedIds) {
    const conversation = byId.get(id);
    if (conversation && !taken.has(id)) {
      taken.add(id);
      pinned.push(conversation);
    }
  }

  return { pinned, rest: conversations.filter((c) => !taken.has(c.id)) };
}
