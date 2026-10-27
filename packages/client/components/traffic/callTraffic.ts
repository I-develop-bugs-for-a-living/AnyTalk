import type { TrafficRecorder } from "./recorder";
import { FRAME_PREVIEW_LIMIT, hostOf, truncateText } from "./summarize";
import type {
  CallBytesEntry,
  CallConnectionEntry,
  CallPeerConnection,
  CallTrackBytes,
  NewEntry,
} from "./types";

/** How often the peer connections are read while recording. */
export const STATS_INTERVAL_MS = 5000;

/** How long one stats read may take before it is given up. */
export const STATS_TIMEOUT_MS = 4000;

/**
 * Plain description of how call media is protected, for the inspector to show
 * (chunk 3 turns it into translated text). Not user-facing text yet.
 */
export const CALL_ENCRYPTION_EXPLANATION = {
  /** Short title. */
  title: "Call media is encrypted twice",
  /** Points in order from the inside out. */
  points: [
    "Inside: end-to-end encryption (LiveKit E2EE, SFrame style) with a key only the participants hold. The media server (SFU) forwards frames it cannot read.",
    "Outside: SRTP over DTLS between your device and the media server, as for any WebRTC call.",
    "A packet capture (for example Wireshark) therefore shows only DTLS/SRTP ciphertext, and the media server only sees end-to-end ciphertext.",
    "Data messages and participant attributes (who watches a stream, deafened, key exchange) go over the signalling WebSocket to the media server. They are not end-to-end encrypted, but the key exchange only carries public keys and keys wrapped for one recipient.",
  ],
} as const;

/** A stats report as returned by `RTCPeerConnection.getStats()`, as a plain record. */
export type StatsRecord = Record<string, unknown> & {
  id: string;
  type: string;
};

/**
 * Turn a `RTCStatsReport` (or anything with `forEach`) into a list of records.
 * Returns an empty list for anything else.
 */
export function statsToRecords(report: unknown): StatsRecord[] {
  const out: StatsRecord[] = [];
  const each = (report as { forEach?: unknown } | undefined)?.forEach;
  if (typeof each !== "function") return out;
  (report as { forEach: (cb: (value: unknown) => void) => void }).forEach(
    (value) => {
      if (value && typeof value === "object") out.push(value as StatsRecord);
    },
  );
  return out;
}

/** The value if it is a non-empty string. */
function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The value if it is a finite number. */
function numOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Read the selected network path and its encryption from a stats report.
 * Returns nothing while no pair is selected yet.
 *
 * @param pc Which peer connection the report belongs to
 * @param reports Stats records of that peer connection
 */
export function parseConnection(
  pc: CallPeerConnection,
  reports: StatsRecord[],
): Omit<CallConnectionEntry, "id" | "time"> | undefined {
  const byId = new Map(reports.map((r) => [r.id, r]));
  const transport = reports.find((r) => r.type === "transport");
  const pair =
    byId.get(transport?.selectedCandidatePairId as string) ??
    reports.find(
      (r) =>
        r.type === "candidate-pair" && r.nominated && r.state === "succeeded",
    );
  if (!pair) return undefined;

  const local = byId.get(pair.localCandidateId as string);
  const remote = byId.get(pair.remoteCandidateId as string);
  const localType = str(local?.candidateType);
  const remoteType = str(remote?.candidateType);
  // true when either side of the pair is a TURN relay candidate
  const relayed = localType === "relay" || remoteType === "relay";

  return {
    kind: "call-connection",
    pc,
    localType,
    remoteType,
    protocol: str(local?.protocol) ?? str(remote?.protocol),
    relayed,
    relayProtocol: relayed ? str(local?.relayProtocol) : undefined,
    relayUrl: str(local?.url),
    // `address` replaced `ip` in newer browsers
    remoteAddress: str(remote?.address) ?? str(remote?.ip),
    remotePort: numOf(remote?.port),
    networkType: str(local?.networkType),
    dtlsState: str(transport?.dtlsState),
    dtlsCipher: str(transport?.dtlsCipher),
    srtpCipher: str(transport?.srtpCipher),
    tlsVersion: str(transport?.tlsVersion),
  };
}

/**
 * A string that is equal for two connection descriptions of the same path,
 * used to record a connection entry only when the path changes.
 */
export function connectionKey(
  connection: Omit<CallConnectionEntry, "id" | "time">,
): string {
  return JSON.stringify([
    connection.pc,
    connection.localType,
    connection.remoteType,
    connection.protocol,
    connection.relayProtocol,
    connection.relayUrl,
    connection.remoteAddress,
    connection.remotePort,
    connection.dtlsState,
    connection.dtlsCipher,
    connection.srtpCipher,
    connection.tlsVersion,
  ]);
}

/**
 * Read cumulative byte counts per media stream and for the whole transport.
 * Simulcast layers of one outgoing track are added up.
 *
 * @param pc Which peer connection the report belongs to
 * @param reports Stats records of that peer connection
 */
export function parseBytes(
  pc: CallPeerConnection,
  reports: StatsRecord[],
): Omit<CallBytesEntry, "id" | "time"> {
  const transport = reports.find((r) => r.type === "transport");
  const tracks = new Map<string, CallTrackBytes>();

  for (const r of reports) {
    const outgoing = r.type === "outbound-rtp";
    if (!outgoing && r.type !== "inbound-rtp") continue;
    const direction = outgoing ? "out" : "in";
    const kind = str(r.kind) ?? str(r.mediaType) ?? "?";
    const id =
      str(r.mid) ?? str(r.trackIdentifier) ?? String(numOf(r.ssrc) ?? r.id);
    const key = `${direction}|${kind}|${id}`;
    const bytes = numOf(outgoing ? r.bytesSent : r.bytesReceived) ?? 0;
    const packets = numOf(outgoing ? r.packetsSent : r.packetsReceived) ?? 0;
    const known = tracks.get(key);
    if (known) {
      known.bytes += bytes;
      known.packets += packets;
    } else {
      tracks.set(key, { direction, kind, id, bytes, packets });
    }
  }

  return {
    kind: "call-bytes",
    pc,
    bytesSent: numOf(transport?.bytesSent),
    bytesReceived: numOf(transport?.bytesReceived),
    tracks: [...tracks.values()],
  };
}

/**
 * A string that is equal when no byte count changed, used to skip snapshots
 * of an idle connection.
 */
export function bytesKey(
  snapshot: Omit<CallBytesEntry, "id" | "time">,
): string {
  return JSON.stringify([
    snapshot.pc,
    snapshot.bytesSent,
    snapshot.bytesReceived,
    snapshot.tracks.map((t) => [t.direction, t.kind, t.id, t.bytes]),
  ]);
}

/**
 * Describe a data message payload: its size and a short text preview.
 *
 * @param payload Bytes as sent or received
 */
export function describePayload(payload: Uint8Array | undefined): {
  size: number;
  preview: string;
  truncated: boolean;
} {
  if (!payload) return { size: 0, preview: "", truncated: false };
  const text = new TextDecoder().decode(
    payload.subarray(0, FRAME_PREVIEW_LIMIT * 4),
  );
  const { text: preview, truncated } = truncateText(text, FRAME_PREVIEW_LIMIT);
  return {
    size: payload.byteLength,
    preview,
    truncated: truncated || payload.byteLength > FRAME_PREVIEW_LIMIT * 4,
  };
}

/** Any function; LiveKit's methods are only reached through this loose type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/** The parts of a LiveKit room the monitor uses; all of it is optional. */
export type CallRoomLike = {
  name?: string;
  localParticipant: {
    publishData?: AnyFn;
    setAttributes?: AnyFn;
  };
  engine?: {
    pcManager?: {
      publisher?: { getStats?: () => Promise<unknown> };
      subscriber?: { getStats?: () => Promise<unknown> };
    };
  };
  on(event: string, listener: AnyFn): unknown;
  off(event: string, listener: AnyFn): unknown;
};

/** What the monitor needs to know about the call it watches. */
export type CallTrafficOptions = {
  /** SFU address the room was joined with. */
  url: string;
  /** Whether the call's media is end-to-end encrypted. */
  e2ee: () => boolean;
  /** Clock, replaceable in tests. */
  now?: () => number;
  /** Stats interval, replaceable in tests. */
  intervalMs?: number;
};

/**
 * Record a call's network details while the recorder is on: the selected
 * network path and byte counts of both peer connections, and every data
 * message and participant attribute we send, and every data message we get.
 * Hooks `publishData` and `setAttributes` of the local participant once, so
 * no call site needs to know. Everything is guarded: a missing or changed
 * private LiveKit API only means fewer entries, never a broken call.
 *
 * @param room The LiveKit room (structurally typed)
 * @param recorder Where entries go
 * @param options Call details
 * @returns A function that removes the hooks and stops the timer
 */
export function monitorCall(
  room: CallRoomLike,
  recorder: TrafficRecorder,
  options: CallTrafficOptions,
): () => void {
  const now = options.now ?? Date.now;
  const local = room.localParticipant;
  /** Records an entry, never throws. */
  const record = (entry: NewEntry) => {
    try {
      recorder.record(entry);
    } catch {
      // never break the call
    }
  };

  // wrap publishData and setAttributes on the instance
  const restore: (() => void)[] = [];
  try {
    const publish = local.publishData;
    if (typeof publish === "function") {
      const hadOwn = Object.prototype.hasOwnProperty.call(local, "publishData");
      // `this` is ignored on purpose: the original is always called on the participant
      local.publishData = function (this: unknown, ...args: unknown[]) {
        if (recorder.enabled) {
          try {
            const [data, opts] = args as [
              Uint8Array,
              {
                reliable?: boolean;
                topic?: string;
                destinationIdentities?: string[];
              }?,
            ];
            const ids = opts?.destinationIdentities;
            record({
              kind: "call-data",
              time: now(),
              direction: "out",
              topic: opts?.topic ?? "",
              destination: ids && ids.length ? [...ids] : "all",
              reliable: opts?.reliable,
              ...describePayload(data),
            });
          } catch {
            // ignore
          }
        }
        return publish.apply(local, args);
      };
      const wrapper = local.publishData;
      restore.push(() => {
        // someone else may have wrapped it since: leave theirs alone
        if (local.publishData !== wrapper) return;
        if (hadOwn) local.publishData = publish;
        else delete local.publishData;
      });
    }
    const setAttributes = local.setAttributes;
    if (typeof setAttributes === "function") {
      const hadOwn = Object.prototype.hasOwnProperty.call(
        local,
        "setAttributes",
      );
      // `this` is ignored on purpose: the original is always called on the participant
      local.setAttributes = function (this: unknown, ...args: unknown[]) {
        if (recorder.enabled) {
          try {
            const attrs = args[0] as Record<string, string> | undefined;
            record({
              kind: "call-attribute",
              time: now(),
              attributes: Object.entries(attrs ?? {}).map(([key, value]) => ({
                key,
                value: truncateText(String(value), FRAME_PREVIEW_LIMIT).text,
              })),
            });
          } catch {
            // ignore
          }
        }
        return setAttributes.apply(local, args);
      };
      const wrapper = local.setAttributes;
      restore.push(() => {
        if (local.setAttributes !== wrapper) return;
        if (hadOwn) local.setAttributes = setAttributes;
        else delete local.setAttributes;
      });
    }
  } catch {
    // keep what was wrapped
  }

  /** Records incoming data messages. */
  const onData = (
    payload?: Uint8Array,
    participant?: { identity?: string },
    _kind?: unknown,
    topic?: string,
  ) => {
    if (!recorder.enabled) return;
    try {
      record({
        kind: "call-data",
        time: now(),
        direction: "in",
        topic: topic ?? "",
        destination: "all",
        identity: participant?.identity,
        ...describePayload(payload),
      });
    } catch {
      // ignore
    }
  };
  try {
    room.on("dataReceived", onData);
  } catch {
    // ignore
  }

  const lastConnection = new Map<CallPeerConnection, string>();
  const lastBytes = new Map<CallPeerConnection, string>();
  /** The E2EE state last announced; undefined until the first entry. */
  let announced: boolean | undefined;
  let reading = false;

  /** Set by the stop function; a tick in flight then records nothing. */
  let stopped = false;

  /** Whether entries may still be recorded. */
  const live = () => !stopped && recorder.enabled;

  /**
   * Read a transport's stats, giving up after a timeout. Returns nothing for
   * a closed transport: LiveKit's `getStats` would create a new
   * RTCPeerConnection through its private `pc` getter.
   */
  const readStats = async (transport: unknown) => {
    const t = transport as
      | { _pc?: { connectionState?: string } | null; getStats?: () => unknown }
      | undefined;
    if (!t || typeof t.getStats !== "function") return undefined;
    if (!t._pc || t._pc.connectionState === "closed") return undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(t.getStats()),
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => resolve(undefined), STATS_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };

  /** Read both peer connections once. */
  const tick = async () => {
    try {
      if (stopped) return;
      if (!recorder.enabled) {
        // start afresh when recording is turned on again
        announced = undefined;
        lastConnection.clear();
        lastBytes.clear();
        return;
      }
      // announce the call, again if the encryption turned on after joining
      const e2ee = options.e2ee();
      if (announced !== e2ee) {
        announced = e2ee;
        record({
          kind: "call-info",
          time: now(),
          room: room.name ?? "",
          url: options.url,
          host: hostOf(options.url),
          e2ee,
        });
      }
      if (reading) return;
      reading = true;
      try {
        const manager = room.engine?.pcManager;
        const sides: [CallPeerConnection, unknown][] = [
          ["publisher", manager?.publisher],
          ["subscriber", manager?.subscriber],
        ];
        for (const [pc, transport] of sides) {
          try {
            const reports = statsToRecords(await readStats(transport));
            if (!reports.length || !live()) continue;

            const connection = parseConnection(pc, reports);
            if (connection) {
              const key = connectionKey(connection);
              if (lastConnection.get(pc) !== key) {
                lastConnection.set(pc, key);
                record({ ...connection, time: now() });
              }
            }

            const bytes = parseBytes(pc, reports);
            const key = bytesKey(bytes);
            if (lastBytes.get(pc) !== key) {
              lastBytes.set(pc, key);
              record({ ...bytes, time: now() });
            }
          } catch {
            // a private API that changed: skip this connection
          }
        }
      } finally {
        reading = false;
      }
    } catch {
      // never an unhandled rejection
    }
  };

  const timer = setInterval(
    () => void tick(),
    options.intervalMs ?? STATS_INTERVAL_MS,
  );

  // the first reading right after joining, so the call-info entry comes
  // before the data messages (the peer connections exist only once connected)
  const onConnected = () => void tick();
  try {
    room.on("connected", onConnected);
  } catch {
    // ignore
  }

  return () => {
    stopped = true;
    clearInterval(timer);
    try {
      room.off("dataReceived", onData);
      room.off("connected", onConnected);
    } catch {
      // ignore
    }
    for (const undo of restore) {
      try {
        undo();
      } catch {
        // ignore
      }
    }
  };
}
