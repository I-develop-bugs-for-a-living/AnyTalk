import type { NotificationState } from "./NotificationOptions";

/**
 * Decide which level to store for a newly joined or created server.
 * Returns undefined when nothing should be written: the server already has an
 * explicit level (so rejoining keeps an earlier choice), or the default equals
 * the fallback and storing it would change nothing.
 * @param existing Explicit level already stored for the server
 * @param defaultState The user's chosen default for new servers
 * @param fallback Level used when a server has no explicit setting
 */
export function resolveNewServerState(
  existing: NotificationState | undefined,
  defaultState: NotificationState,
  fallback: NotificationState,
): NotificationState | undefined {
  if (existing !== undefined) return undefined;
  if (defaultState === fallback) return undefined;
  return defaultState;
}
