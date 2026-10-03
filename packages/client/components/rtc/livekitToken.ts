/**
 * Room a LiveKit token is for, read from its claims (rooms are named after
 * the channel)
 * @param token LiveKit access token (JWT)
 * @returns Room name, if readable
 */
export function tokenRoom(token: string): string | undefined {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")),
    );
    return typeof claims?.video?.room === "string"
      ? claims.video.room
      : undefined;
  } catch {
    return undefined;
  }
}
