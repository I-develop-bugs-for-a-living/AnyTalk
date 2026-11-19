/** Which way a camera faces, as reported by the browser */
export type FacingMode = "user" | "environment";

/**
 * The facing mode to flip to.
 * @param current Facing mode the camera reports now, if any
 * @returns The opposite one, or undefined when the camera reports none
 */
export function oppositeFacingMode(current?: string): FacingMode | undefined {
  if (current === "user") return "environment";
  if (current === "environment") return "user";
  return undefined;
}

/**
 * The next camera to cycle to, for cameras that don't report a facing mode.
 * @param deviceIds IDs of all cameras, in list order
 * @param currentId ID of the camera in use
 * @returns The following camera (wrapping around), or undefined if there is
 * no other camera
 */
export function nextDeviceId(
  deviceIds: string[],
  currentId?: string,
): string | undefined {
  if (deviceIds.length < 2) return undefined;
  const index = currentId ? deviceIds.indexOf(currentId) : -1;
  return deviceIds[(index + 1) % deviceIds.length];
}
