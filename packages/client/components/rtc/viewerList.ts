/**
 * Who to show as watching a stream: everyone but ourselves, without
 * duplicates
 *
 * @param viewers Identities reported as watching
 * @param localIdentity Our own identity, never listed
 * @returns The identities to show
 */
export function otherViewers(
  viewers: string[],
  localIdentity?: string,
): string[] {
  return [...new Set(viewers)].filter((id) => id !== localIdentity);
}
