/** The parts of a track the floating call window looks at */
export type PipCandidate = {
  source: string;
  publication?: { isMuted?: boolean } | undefined;
};

/**
 * Whether a focused track has something to show: a screen share, or a camera
 * that is publishing video.
 * @param track The track
 * @returns True for a stream or a running camera
 */
export function hasPipVideo(track: PipCandidate): boolean {
  if (track.source === "screen_share") return true;
  return (
    track.source === "camera" &&
    !!track.publication &&
    !track.publication.isMuted
  );
}

/**
 * Pick the track for the floating call window, in this order: the focused
 * one if it has video, the first watched stream, the user's own screen
 * share. Tracks shown in a window of their own never count.
 * @param focused The focused track, if any
 * @param watched Streams open in the call window, in order
 * @param own The user's own screen share, if sharing
 * @param isPoppedOut Whether a track is shown in a window of its own
 * @returns The track to show, or undefined for no window
 */
export function pickPipTrack<T extends PipCandidate>(
  focused: T | undefined,
  watched: T[],
  own: T | undefined,
  isPoppedOut: (track: T) => boolean,
): T | undefined {
  if (focused && hasPipVideo(focused) && !isPoppedOut(focused)) return focused;
  const stream = watched.find((track) => !isPoppedOut(track));
  if (stream) return stream;
  return own && !isPoppedOut(own) ? own : undefined;
}
