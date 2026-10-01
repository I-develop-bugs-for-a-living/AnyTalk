import { Accessor, Setter, createSignal } from "solid-js";

import localforage from "localforage";

/**
 * Developer mode: WebRTC statistics for video tracks in a call.
 *
 * Every second the recorder samples each video track, keeps the latest sample
 * for the live overlay and appends it to a session. Sessions are saved to
 * IndexedDB as "stream recaps" once the track goes away.
 */

export const STATS_INTERVAL_MS = 1000;

/** Maximum number of recaps kept on this device */
const MAX_RECAPS = 50;

/** Sessions shorter than this are not worth keeping */
const MIN_SAMPLES = 5;

/** Persist in-progress sessions this often, so a crash loses little */
const CHECKPOINT_EVERY = 30;

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
  /** Estimated available bandwidth in bits per second */
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
}

type Report = RTCStats & Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/**
 * Turns successive stats reports for one track into samples
 */
export class Parser {
  #prev = new Map<string, Report>();

  /** Difference of a cumulative counter since the previous report */
  #delta(report: Report, key: string) {
    const now = num(report[key]);
    const before = num(this.#prev.get(report.id)?.[key]);
    return now !== undefined && before !== undefined
      ? Math.max(0, now - before)
      : undefined;
  }

  #rate(report: Report, key: string) {
    const prev = this.#prev.get(report.id);
    const bytes = this.#delta(report, key);
    if (bytes === undefined || !prev || report.timestamp <= prev.timestamp)
      return undefined;
    return (bytes * 8 * 1000) / (report.timestamp - prev.timestamp);
  }

  parse(reports: Report[], t: number): { sample: Sample; info: StreamInfo } {
    const byId = new Map(reports.map((r) => [r.id, r]));
    const sample: Sample = { t };
    const info: StreamInfo = {};

    // connection
    const transport = reports.find((r) => r.type === "transport");
    const pair =
      byId.get(transport?.selectedCandidatePairId as string) ??
      reports.find(
        (r) =>
          r.type === "candidate-pair" && r.nominated && r.state === "succeeded",
      );

    if (pair) {
      const rtt = num(pair.currentRoundTripTime);
      if (rtt !== undefined) sample.rtt = rtt * 1000;
      sample.available =
        num(pair.availableOutgoingBitrate) ??
        num(pair.availableIncomingBitrate);

      const local = byId.get(pair.localCandidateId as string);
      if (local) {
        info.transport = `${String(local.protocol ?? "?").toUpperCase()} / ${local.candidateType}${
          local.candidateType === "relay"
            ? ` (${local.relayProtocol ?? "?"})`
            : ""
        }`;
      }
    }

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

    for (const r of [...outbound, ...(inbound ? [inbound] : [])]) {
      this.#prev.set(r.id, r);
    }
    for (const r of reports) {
      if (r.type === "remote-inbound-rtp") this.#prev.set(r.id, r);
    }

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
  return bps >= 1_000_000
    ? `${(bps / 1_000_000).toFixed(2)} Mbps`
    : `${Math.round(bps / 1000)} kbps`;
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

const storage = localforage.createInstance({
  name: "anytalk",
  storeName: "stream_recaps",
});

const INDEX_KEY = "index";

/**
 * Stream recap storage (local to this device)
 */
export const recaps = {
  async list(): Promise<RecapMeta[]> {
    return (await storage.getItem<RecapMeta[]>(INDEX_KEY)) ?? [];
  },

  async get(id: string): Promise<Recap | null> {
    return storage.getItem<Recap>(`recap:${id}`);
  },

  async save(recap: Recap) {
    const { info: _info, data: _data, ...meta } = recap;
    const index = (await this.list()).filter((r) => r.id !== recap.id);
    index.unshift(meta);

    // drop the oldest recaps past the limit
    for (const old of index.splice(MAX_RECAPS)) {
      await storage.removeItem(`recap:${old.id}`);
    }

    await storage.setItem(`recap:${recap.id}`, recap);
    await storage.setItem(INDEX_KEY, index);
    setRevision((n) => n + 1);
  },

  async remove(id: string) {
    await storage.removeItem(`recap:${id}`);
    await storage.setItem(
      INDEX_KEY,
      (await this.list()).filter((r) => r.id !== id),
    );
    setRevision((n) => n + 1);
  },

  async clear() {
    await storage.clear();
    setRevision((n) => n + 1);
  },
};

/** Bumped whenever the stored recaps change */
const [revision, setRevision] = createSignal(0);
export { revision as recapsRevision };

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
   */
  async tick(tracks: TrackDescriptor[]) {
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

        session.data.push(sample);
        session.infos.push(info);
        session.info = { ...session.info, ...info, layers: undefined };
        latest[track.key] = { sample, info, direction: track.direction };

        if (session.data.length % CHECKPOINT_EVERY === 0) {
          await this.#save(session);
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
