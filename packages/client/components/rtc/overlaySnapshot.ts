/**
 * Pure helpers for the in-game overlay snapshot (desktop app). The snapshot
 * is what the main window sends to the native shell, see OverlayPublisher.
 */

/** One call participant as the overlay draws them */
export type OverlayParticipantState = {
  id: string;
  name: string;
  avatar?: string;
  speaking: boolean;
  streaming: boolean;
  /** Microphone off (muted, or no microphone track published) */
  muted: boolean;
  /** Deafened; implies muted for the overlay's badge */
  deafened: boolean;
  /** Watching the local user's stream (never true for the local row) */
  watchingYou: boolean;
};

/** Call snapshot sent to the desktop shell */
export type OverlayStateSnapshot = {
  inCall: boolean;
  participants: OverlayParticipantState[];
};

/** The snapshot for "not in a call" */
export const EMPTY_OVERLAY_STATE: OverlayStateSnapshot = {
  inCall: false,
  participants: [],
};

/**
 * Put the participants in the order of the call, leaving out those the
 * participant reporters haven't filled in yet.
 * @param inCall Whether we are in a call
 * @param order Participant ids in display order
 * @param known Latest data by participant id
 * @returns The snapshot, empty when not in a call
 */
export function buildOverlayState(
  inCall: boolean,
  order: string[],
  known: Record<string, OverlayParticipantState | undefined>,
): OverlayStateSnapshot {
  if (!inCall) return EMPTY_OVERLAY_STATE;
  const participants: OverlayParticipantState[] = [];
  for (const id of order) {
    const entry = known[id];
    if (entry) participants.push(entry);
  }
  return { inCall: true, participants };
}

/**
 * Whether two snapshots draw the same, used to skip needless messages.
 * @param a First snapshot
 * @param b Second snapshot
 * @returns True when nothing visible differs
 */
export function sameOverlayState(
  a: OverlayStateSnapshot,
  b: OverlayStateSnapshot,
): boolean {
  if (a.inCall !== b.inCall) return false;
  if (a.participants.length !== b.participants.length) return false;
  return a.participants.every((p, i) => {
    const q = b.participants[i];
    return (
      p.id === q.id &&
      p.name === q.name &&
      p.avatar === q.avatar &&
      p.speaking === q.speaking &&
      p.streaming === q.streaming &&
      p.muted === q.muted &&
      p.deafened === q.deafened &&
      p.watchingYou === q.watchingYou
    );
  });
}
