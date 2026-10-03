import { Accessor, Setter, createSignal } from "solid-js";

import localforage from "localforage";

/**
 * Developer mode: WebRTC statistics for video tracks in a call (voice is in
 * callStats.ts).
 *
 * Every second the recorder samples each video track, keeps the latest sample
 * for the live overlay and appends it to a session. Sessions are saved to
 * IndexedDB as "stream recaps" once the track goes away.
 */

export const STATS_INTERVAL_MS = 1000;

/** Maximum number of recaps of each kind kept on this device */
const MAX_RECAPS = 20;

/** Sessions shorter than this are not worth keeping */
export const MIN_SAMPLES = 5;

/** Persist in-progress sessions this often, so a crash loses little */
export const CHECKPOINT_EVERY = 30;

export type Direction = "sending" | "receiving";

/**
 * One measurement of a video track. Counters are per-interval deltas,
 * so a chart of them reads as "per second".
 */
export interface Sample {
  /** Milliseconds since the session started */
  t: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Bits per second across all active layers */
  bitrate?: number;
  rtt?: number;
  /**
   * Estimated available bandwidth in bits per second, in the direction of
   * the track (upload when sending, download when receiving)
   */
  available?: number;
  pli?: number;
  nack?: number;
  lost?: number;

  // sending
  targetBitrate?: number;
  activeLayers?: number;
  limitation?: string;

  // receiving
  received?: number;
  dropped?: number;
  /** Seconds spent frozen during this interval */
  frozen?: number;
  freezes?: number;
  jitter?: number;
  jitterBuffer?: number;
}

/** Values that rarely change, shown as text */
export interface StreamInfo {
  codec?: string;
  encoder?: string;
  decoder?: string;
  transport?: string;
  /** Per-layer readout for the live overlay */
  layers?: { rid: string; text: string }[];
}

export interface RecapMeta {
  id: string;
  direction: Direction;
  source: string;
  participantId: string;
  participantName: string;
  channelName?: string;
  serverName?: string;
  startedAt: number;
  endedAt: number;
  samples: number;
  summary: RecapSummary;
}

export interface RecapSummary {
  avgBitrate?: number;
  avgFps?: number;
  maxWidth?: number;
  maxHeight?: number;
  freezes: number;
  frozenSeconds: number;
  lost: number;
  received: number;
  avgRtt?: number;
  maxRtt?: number;
  /** Seconds spent under each quality limitation reason */
  limitation: Record<string, number>;
  transports: string[];
}

export interface Recap extends RecapMeta {
  info: StreamInfo;
  data: Sample[];
}

export interface TrackDescriptor {
  key: string;
  direction: Direction;
  source: string;
  participantId: string;
  participantName: string;
  channelName?: string;
  serverName?: string;
  getStats: () => Promise<RTCStatsReport | undefined>;
  /** LiveKit's view of the participant's connection, if known */
  connectionQuality?: () => string;
}

export type Report = RTCStats & Record<string, unknown>;

export const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/**
 * Round trip time, bandwidth estimates and transport of the connection a
 * track's stats report belongs to
 */
export function readConnection(reports: Report[], byId: Map<string, Report>) {
  const transport = reports.find((r) => r.type === "transport");
  const pair =
    byId.get(transport?.selectedCandidatePairId as string) ??
    reports.find(
      (r) =>
        r.type === "candidate-pair" && r.nominated && r.state === "succeeded",
    );
  if (!pair) return {};

  const rtt = num(pair.currentRoundTripTime);
  const local = byId.get(pair.localCandidateId as string);

  return {
    rtt: rtt !== undefined ? rtt * 1000 : undefined,
    availableOutgoing: num(pair.availableOutgoingBitrate),
    availableIncoming: num(pair.availableIncomingBitrate),
    transport: local
      ? `${String(local.protocol ?? "?").toUpperCase()} / ${local.candidateType}${
          local.candidateType === "relay"
            ? ` (${local.relayProtocol ?? "?"})`
            : ""
        }`
      : undefined,
  };
}

/**
 * Tracks cumulative counters between successive stats reports
 */
export class Counters {
  #prev = new Map<string, Report>();

  /** Difference of a cumulative counter since the previous report */
  delta(report: Report, key: string) {
    const now = num(report[key]);
    const before = num(this.#prev.get(report.id)?.[key]);
    return now !== undefined && before !== undefined
      ? Math.max(0, now - before)
      : undefined;
  }

  /** Bits per second of a byte counter since the previous report */
  rate(report: Report, key: string) {
    const prev = this.#prev.get(report.id);
    const bytes = this.delta(report, key);
    if (bytes === undefined || !prev || report.timestamp <= prev.timestamp)
      return undefined;
    return (bytes * 8 * 1000) / (report.timestamp - prev.timestamp);
  }

  /** Remember reports for the next comparison */
  remember(reports: Report[]) {
    for (const r of reports) this.#prev.set(r.id, r);
  }
}

/**
 * Turns successive stats reports for one track into samples
 */
export class Parser {
  #counters = new Counters();

  #delta(report: Report, key: string) {
    return this.#counters.delta(report, key);
  }

  #rate(report: Report, key: string) {
    return this.#counters.rate(report, key);
  }

  parse(reports: Report[], t: number): { sample: Sample; info: StreamInfo } {
    const byId = new Map(reports.map((r) => [r.id, r]));
    const sample: Sample = { t };
    const info: StreamInfo = {};

    const connection = readConnection(reports, byId);
    if (connection.rtt !== undefined) sample.rtt = connection.rtt;
    if (connection.transport) info.transport = connection.transport;

    const outbound = reports.filter(
      (r) => r.type === "outbound-rtp" && r.kind === "video",
    );

    if (outbound.length) {
      outbound.sort(
        (a, b) => (num(b.frameWidth) ?? 0) - (num(a.frameWidth) ?? 0),
      );

      let bitrate = 0,
        active = 0;
      info.layers = [];

      for (const r of outbound) {
        const rate = this.#rate(r, "bytesSent");
        const isActive = r.active !== false && !!num(r.frameWidth);
        if (isActive) {
          active++;
          bitrate += rate ?? 0;
        }
        info.layers.push({
          rid: String(r.rid ?? "-"),
          text: isActive
            ? `${r.frameWidth}x${r.frameHeight} @ ${num(r.framesPerSecond) ?? 0} fps, ${
                rate !== undefined ? formatBitrate(rate) : "-"
              }`
            : "paused",
        });
      }

      const top = outbound.find((r) => num(r.frameWidth));
      sample.bitrate = bitrate;
      sample.activeLayers = active;
      sample.available = connection.availableOutgoing;
      sample.pli = sumDelta(outbound, (r) => this.#delta(r, "pliCount"));
      sample.nack = sumDelta(outbound, (r) => this.#delta(r, "nackCount"));

      if (top) {
        sample.width = num(top.frameWidth);
        sample.height = num(top.frameHeight);
        sample.fps = num(top.framesPerSecond) ?? 0;
        sample.targetBitrate = num(top.targetBitrate);
        sample.limitation = String(top.qualityLimitationReason ?? "none");
        info.encoder = top.encoderImplementation as string | undefined;
        info.codec = byId.get(top.codecId as string)?.mimeType as
          | string
          | undefined;
      }

      const remote = reports.filter(
        (r) => r.type === "remote-inbound-rtp" && r.kind === "video",
      );
      sample.lost = sumDelta(remote, (r) => this.#delta(r, "packetsLost"));
    }

    const inbound = reports.find(
      (r) => r.type === "inbound-rtp" && r.kind === "video",
    );

    if (inbound) {
      sample.bitrate = this.#rate(inbound, "bytesReceived");
      // not availableOutgoingBitrate: the receiving connection sends next to
      // nothing, so its upload estimate climbs unchecked to the 1 Gbps cap
      sample.available = connection.availableIncoming;
      sample.width = num(inbound.frameWidth);
      sample.height = num(inbound.frameHeight);
      sample.fps = num(inbound.framesPerSecond) ?? 0;
      sample.lost = this.#delta(inbound, "packetsLost");
      sample.received = this.#delta(inbound, "packetsReceived");
      sample.dropped = this.#delta(inbound, "framesDropped");
      sample.pli = this.#delta(inbound, "pliCount");
      sample.nack = this.#delta(inbound, "nackCount");
      sample.freezes = this.#delta(inbound, "freezeCount");
      sample.frozen = this.#delta(inbound, "totalFreezesDuration");

      const jitter = num(inbound.jitter);
      if (jitter !== undefined) sample.jitter = jitter * 1000;

      // average jitter buffer delay over this interval
      const delay = this.#delta(inbound, "jitterBufferDelay"),
        emitted = this.#delta(inbound, "jitterBufferEmittedCount");
      if (delay !== undefined && emitted) {
        sample.jitterBuffer = (delay / emitted) * 1000;
      }

      info.decoder = inbound.decoderImplementation as string | undefined;
      info.codec = byId.get(inbound.codecId as string)?.mimeType as
        | string
        | undefined;
    }

    this.#counters.remember([
      ...outbound,
      ...(inbound ? [inbound] : []),
      ...reports.filter((r) => r.type === "remote-inbound-rtp"),
    ]);

    return { sample, info };
  }
}

function sumDelta(
  reports: Report[],
  fn: (r: Report) => number | undefined,
): number | undefined {
  let total: number | undefined;
  for (const r of reports) {
    const v = fn(r);
    if (v !== undefined) total = (total ?? 0) + v;
  }
  return total;
}

/**
 * Readable name for a simulcast layer (LiveKit sends up to three copies:
 * f = full size, h = half size, q = quarter size)
 */
export function layerName(rid: string) {
  return rid === "f"
    ? "Full-size copy"
    : rid === "h"
      ? "Half-size copy"
      : rid === "q"
        ? "Quarter-size copy"
        : "Video";
}

export function formatBitrate(bps: number) {
  return bps >= 1_000_000_000
    ? `${(bps / 1_000_000_000).toFixed(2)} Gbps`
    : bps >= 1_000_000
      ? `${(bps / 1_000_000).toFixed(2)} Mbps`
      : `${Math.round(bps / 1000)} kbps`;
}

/**
 * Whether the stream was frozen (1) or running (0) at each sample.
 *
 * Browsers only add to totalFreezesDuration once a freeze ends, so the whole
 * freeze lands in a single sample; spread it back over the samples it covered.
 */
export function frozenTimeline(data: Sample[]): (number | undefined)[] {
  const out: (number | undefined)[] = data.map((s) =>
    s.frozen === undefined ? undefined : 0,
  );

  data.forEach((s, i) => {
    if (!s.frozen) return;
    const start = s.t - s.frozen * 1000;
    for (let j = i; j >= 0 && data[j].t > start; j--) out[j] = 1;
  });

  return out;
}

/**
 * Summarise a session's samples
 */
export function summarise(data: Sample[], info: StreamInfo[]): RecapSummary {
  const avg = (key: keyof Sample) => {
    const values = data
      .map((s) => s[key])
      .filter((v): v is number => typeof v === "number");
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : undefined;
  };

  const total = (key: keyof Sample) =>
    data.reduce((acc, s) => acc + ((s[key] as number | undefined) ?? 0), 0);

  const limitation: Record<string, number> = {};
  for (const s of data) {
    if (s.limitation) {
      limitation[s.limitation] =
        (limitation[s.limitation] ?? 0) + STATS_INTERVAL_MS / 1000;
    }
  }

  const rtts = data
    .map((s) => s.rtt)
    .filter((v): v is number => v !== undefined);

  return {
    avgBitrate: avg("bitrate"),
    avgFps: avg("fps"),
    maxWidth: Math.max(0, ...data.map((s) => s.width ?? 0)) || undefined,
    maxHeight: Math.max(0, ...data.map((s) => s.height ?? 0)) || undefined,
    freezes: total("freezes"),
    frozenSeconds: total("frozen"),
    lost: total("lost"),
    received: total("received"),
    avgRtt: avg("rtt"),
    maxRtt: rtts.length ? Math.max(...rtts) : undefined,
    limitation,
    transports: [
      ...new Set(info.map((i) => i.transport).filter(Boolean) as string[]),
    ],
  };
}

/**
 * Recaps saved on this device, newest first; only the newest
 * {@link MAX_RECAPS} are kept. The index holds everything but the samples.
 */
export function createRecapStore<
  Meta extends { id: string },
  Full extends Meta,
>(storeName: string, toMeta: (recap: Full) => Meta) {
  const storage = localforage.createInstance({ name: "anytalk", storeName });
  const INDEX_KEY = "index";

  /** Bumped whenever the stored recaps change */
  const [revision, setRevision] = createSignal(0);

  return {
    revision,

    async list(): Promise<Meta[]> {
      return (await storage.getItem<Meta[]>(INDEX_KEY)) ?? [];
    },

    async get(id: string): Promise<Full | null> {
      return storage.getItem<Full>(`recap:${id}`);
    },

    async save(recap: Full) {
      const index = (await this.list()).filter((r) => r.id !== recap.id);
      index.unshift(toMeta(recap));

      // drop the oldest recaps past the limit
      for (const old of index.splice(MAX_RECAPS)) {
        await storage.removeItem(`recap:${old.id}`);
      }

      await storage.setItem(`recap:${recap.id}`, recap);
      await storage.setItem(INDEX_KEY, index);
      setRevision((n) => n + 1);
    },

    async remove(id: string) {
      await this.removeMany([id]);
    },

    async removeMany(ids: string[]) {
      const remove = new Set(ids);
      for (const id of remove) await storage.removeItem(`recap:${id}`);
      await storage.setItem(
        INDEX_KEY,
        (await this.list()).filter((r) => !remove.has(r.id)),
      );
      setRevision((n) => n + 1);
    },

    async clear() {
      await storage.clear();
      setRevision((n) => n + 1);
    },
  };
}

/**
 * Stream recap storage (local to this device)
 */
export const recaps = createRecapStore<RecapMeta, Recap>(
  "stream_recaps",
  ({ info: _info, data: _data, ...meta }) => meta,
);

export const recapsRevision = recaps.revision;

interface Session {
  meta: Omit<RecapMeta, "endedAt" | "samples" | "summary">;
  parser: Parser;
  data: Sample[];
  infos: StreamInfo[];
  info: StreamInfo;
}

/**
 * Samples video tracks while developer mode is on
 */
type Latest = Record<
  string,
  { sample: Sample; info: StreamInfo; direction: Direction }
>;

export class StatsRecorder {
  #sessions = new Map<string, Session>();
  #setLatest: Setter<Latest>;

  /** Latest sample per track, for the live overlay */
  latest: Accessor<Latest>;

  constructor() {
    const [latest, setLatest] = createSignal<Latest>({});
    this.latest = latest;
    this.#setLatest = setLatest;
  }

  /**
   * Sample every given track once
   *
   * @param record Keep the samples and save them as stream recaps; otherwise
   * only the latest sample is kept for the live overlay
   */
  async tick(tracks: TrackDescriptor[], { record }: { record: boolean }) {
    const seen = new Set<string>();
    const latest: Latest = {};

    await Promise.all(
      tracks.map(async (track) => {
        const report = await track.getStats().catch(() => undefined);
        if (!report) return;

        let session = this.#sessions.get(track.key);
        if (!session) {
          session = {
            meta: {
              id: `${Date.now()}-${track.key}`,
              direction: track.direction,
              source: track.source,
              participantId: track.participantId,
              participantName: track.participantName,
              channelName: track.channelName,
              serverName: track.serverName,
              startedAt: Date.now(),
            },
            parser: new Parser(),
            data: [],
            infos: [],
            info: {},
          };
          this.#sessions.set(track.key, session);
        }

        seen.add(track.key);

        const { sample, info } = session.parser.parse(
          [...report.values()] as Report[],
          Date.now() - session.meta.startedAt,
        );

        latest[track.key] = { sample, info, direction: track.direction };

        if (record) {
          session.data.push(sample);
          session.infos.push(info);
          session.info = { ...session.info, ...info, layers: undefined };

          if (session.data.length % CHECKPOINT_EVERY === 0) {
            await this.#save(session);
          }
        }
      }),
    );

    this.#setLatest(latest);

    // tracks that disappeared have ended
    for (const [key, session] of this.#sessions) {
      if (!seen.has(key)) {
        this.#sessions.delete(key);
        await this.#save(session);
      }
    }
  }

  /**
   * End every session, e.g. when leaving the call or turning developer mode off
   */
  async flush() {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    this.#setLatest({});
    await Promise.all(sessions.map((s) => this.#save(s)));
  }

  async #save(session: Session) {
    if (session.data.length < MIN_SAMPLES) return;

    await recaps.save({
      ...session.meta,
      endedAt: session.meta.startedAt + session.data.at(-1)!.t,
      samples: session.data.length,
      summary: summarise(session.data, session.infos),
      info: session.info,
      data: session.data,
    });
  }
}

export const statsRecorder = new StatsRecorder();
