import { Accessor, Setter, createSignal } from "solid-js";

import {
  CHECKPOINT_EVERY,
  Counters,
  Direction,
  MIN_SAMPLES,
  Report,
  TrackDescriptor,
  createRecapStore,
  num,
  readConnection,
} from "./stats";

/**
 * Developer mode: WebRTC statistics for voice in a call.
 *
 * Every second the recorder samples our microphone (outgoing) and everyone
 * else's (incoming). A call is one session, saved to IndexedDB as a "call
 * recap" with one series per microphone.
 */

/**
 * One measurement of a microphone track. Counters are per-interval deltas,
 * so a chart of them reads as "per second".
 */
export interface AudioSample {
  /** Milliseconds since the call started */
  t: number;
  /** Bits per second */
  bitrate?: number;
  /** Packets sent or received */
  packets?: number;
  /** Packets lost (on the way to the server when sending) */
  lost?: number;
  jitter?: number;
  rtt?: number;
  /** Microphone or playback level, 0 to 1 */
  level?: number;
  /**
   * LiveKit's rating of the participant's connection: 3 excellent, 2 good,
   * 1 poor, 0 lost
   */
  quality?: number;

  // sending
  /** Estimated available upload in bits per second */
  available?: number;

  // receiving
  /** Share of audio that had to be made up to hide lost packets, 0 to 1 */
  concealed?: number;
  jitterBuffer?: number;
}

export interface AudioSummary {
  avgBitrate?: number;
  /** Lost packets as a share of all packets, 0 to 1 */
  loss?: number;
  avgJitter?: number;
  maxJitter?: number;
  avgRtt?: number;
  maxRtt?: number;
  /** Average share of concealed audio, 0 to 1 */
  concealed?: number;
  /** Share of the time LiveKit rated the connection poor or lost, 0 to 1 */
  poorConnection?: number;
}

/** Connection quality as charted, see {@link AudioSample.quality} */
export const QUALITY_LEVELS: Record<string, number> = {
  excellent: 3,
  good: 2,
  poor: 1,
  lost: 0,
};

/** Samples of one microphone over the call */
export interface CallSeries {
  key: string;
  direction: Direction;
  participantId: string;
  participantName: string;
  codec?: string;
  data: AudioSample[];
  summary: AudioSummary;
}

export interface CallRecapMeta {
  id: string;
  channelName?: string;
  serverName?: string;
  startedAt: number;
  endedAt: number;
  /** Everyone else heard during the call */
  participants: string[];
  transport?: string;
  /** Our own microphone */
  outgoing?: AudioSummary;
  /** Worst incoming loss, to spot bad calls in the list */
  worstIncomingLoss?: number;
}

export interface CallRecap extends CallRecapMeta {
  series: CallSeries[];
}

/**
 * Turns successive stats reports for one microphone into samples
 */
export class AudioParser {
  #counters = new Counters();

  parse(
    reports: Report[],
    t: number,
  ): { sample: AudioSample; codec?: string; transport?: string } {
    const byId = new Map(reports.map((r) => [r.id, r]));
    const sample: AudioSample = { t };
    const c = this.#counters;

    const connection = readConnection(reports, byId);
    sample.rtt = connection.rtt;

    const outbound = reports.find(
      (r) => r.type === "outbound-rtp" && r.kind === "audio",
    );
    const inbound = reports.find(
      (r) => r.type === "inbound-rtp" && r.kind === "audio",
    );
    const remote = reports.find(
      (r) => r.type === "remote-inbound-rtp" && r.kind === "audio",
    );

    if (outbound) {
      sample.bitrate = c.rate(outbound, "bytesSent");
      sample.packets = c.delta(outbound, "packetsSent");
      sample.available = connection.availableOutgoing;

      const source = reports.find(
        (r) => r.type === "media-source" && r.kind === "audio",
      );
      sample.level = num(source?.audioLevel);

      // what the server reports back about our packets
      if (remote) {
        sample.lost = c.delta(remote, "packetsLost");
        const jitter = num(remote.jitter);
        if (jitter !== undefined) sample.jitter = jitter * 1000;
        const rtt = num(remote.roundTripTime);
        if (sample.rtt === undefined && rtt !== undefined)
          sample.rtt = rtt * 1000;
      }
    }

    if (inbound) {
      sample.bitrate = c.rate(inbound, "bytesReceived");
      sample.packets = c.delta(inbound, "packetsReceived");
      sample.lost = c.delta(inbound, "packetsLost");
      sample.level = num(inbound.audioLevel);

      const jitter = num(inbound.jitter);
      if (jitter !== undefined) sample.jitter = jitter * 1000;

      const delay = c.delta(inbound, "jitterBufferDelay"),
        emitted = c.delta(inbound, "jitterBufferEmittedCount");
      if (delay !== undefined && emitted) {
        sample.jitterBuffer = (delay / emitted) * 1000;
      }

      const concealed = c.delta(inbound, "concealedSamples"),
        total = c.delta(inbound, "totalSamplesReceived");
      if (concealed !== undefined && total) {
        sample.concealed = Math.min(1, concealed / total);
      }
    }

    const rtp = outbound ?? inbound;
    const codec = byId.get(rtp?.codecId as string)?.mimeType as
      | string
      | undefined;

    c.remember([outbound, inbound, remote].filter((r): r is Report => !!r));

    return { sample, codec, transport: connection.transport };
  }
}

/**
 * Summarise one microphone's samples
 */
export function summariseAudio(data: AudioSample[]): AudioSummary {
  const values = (key: keyof AudioSample) =>
    data.map((s) => s[key]).filter((v): v is number => typeof v === "number");
  const avg = (key: keyof AudioSample) => {
    const v = values(key);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const max = (key: keyof AudioSample) => {
    const v = values(key);
    return v.length ? Math.max(...v) : undefined;
  };
  const total = (key: keyof AudioSample) =>
    values(key).reduce((a, b) => a + b, 0);

  const lost = total("lost"),
    packets = total("packets");
  const quality = values("quality");

  return {
    avgBitrate: avg("bitrate"),
    loss: lost + packets ? lost / (lost + packets) : undefined,
    avgJitter: avg("jitter"),
    maxJitter: max("jitter"),
    avgRtt: avg("rtt"),
    maxRtt: max("rtt"),
    concealed: avg("concealed"),
    poorConnection: quality.length
      ? quality.filter((q) => q <= 1).length / quality.length
      : undefined,
  };
}

/**
 * Call recap storage (local to this device)
 */
export const callRecaps = createRecapStore<CallRecapMeta, CallRecap>(
  "call_recaps",
  ({ series: _series, ...meta }) => meta,
);

/** What the call is, for the recap list */
export interface CallContext {
  channelName?: string;
  serverName?: string;
}

interface SeriesState {
  meta: Omit<CallSeries, "data" | "summary">;
  parser: AudioParser;
  data: AudioSample[];
}

interface CallSession {
  meta: CallContext & { id: string; startedAt: number };
  series: Map<string, SeriesState>;
  transport?: string;
  ticks: number;
}

/** Latest sample per participant identity, for the live overlay */
type Latest = Record<
  string,
  { sample: AudioSample; codec?: string; direction: Direction }
>;

/**
 * Samples microphones while voice developer mode is on
 */
export class CallRecorder {
  #session?: CallSession;
  #setLatest: Setter<Latest>;

  latest: Accessor<Latest>;

  constructor() {
    const [latest, setLatest] = createSignal<Latest>({});
    this.latest = latest;
    this.#setLatest = setLatest;
  }

  /**
   * Sample every given microphone once
   *
   * @param record Keep the samples and save the call as a recap; otherwise
   * only the latest sample is kept for the live overlay
   */
  async tick(
    call: CallContext,
    tracks: TrackDescriptor[],
    { record }: { record: boolean },
  ) {
    const session: CallSession = (this.#session ??= {
      meta: { ...call, id: `${Date.now()}-call`, startedAt: Date.now() },
      series: new Map(),
      ticks: 0,
    });

    const latest: Latest = {};
    const t = Date.now() - session.meta.startedAt;

    await Promise.all(
      tracks.map(async (track) => {
        const report = await track.getStats().catch(() => undefined);
        if (!report) return;

        let series = session.series.get(track.key);
        if (!series) {
          series = {
            meta: {
              key: track.key,
              direction: track.direction,
              participantId: track.participantId,
              participantName: track.participantName,
            },
            parser: new AudioParser(),
            data: [],
          };
          session.series.set(track.key, series);
        }

        const { sample, codec, transport } = series.parser.parse(
          [...report.values()] as Report[],
          t,
        );
        if (codec) series.meta.codec = codec;

        const quality = QUALITY_LEVELS[track.connectionQuality?.() ?? ""];
        if (quality !== undefined) sample.quality = quality;
        if (transport) session.transport = transport;

        latest[track.participantId] = {
          sample,
          codec: series.meta.codec,
          direction: track.direction,
        };

        if (record) series.data.push(sample);
      }),
    );

    this.#setLatest(latest);

    if (record && ++session.ticks % CHECKPOINT_EVERY === 0) {
      await this.#save(session);
    }
  }

  /**
   * End the call, e.g. when leaving it or turning developer mode off
   */
  async flush() {
    const session = this.#session;
    this.#session = undefined;
    this.#setLatest({});
    if (session) await this.#save(session);
  }

  async #save(session: CallSession) {
    if (session.ticks < MIN_SAMPLES) return;

    const series: CallSeries[] = [...session.series.values()]
      .filter((s) => s.data.length)
      .map((s) => ({
        ...s.meta,
        data: s.data,
        summary: summariseAudio(s.data),
      }));

    const lastSample = Math.max(0, ...series.map((s) => s.data.at(-1)!.t));
    const incoming = series.filter((s) => s.direction === "receiving");
    const losses = incoming
      .map((s) => s.summary.loss)
      .filter((v): v is number => v !== undefined);

    await callRecaps.save({
      ...session.meta,
      endedAt: session.meta.startedAt + lastSample,
      participants: [...new Set(incoming.map((s) => s.participantName))],
      transport: session.transport,
      outgoing: series.find((s) => s.direction === "sending")?.summary,
      worstIncomingLoss: losses.length ? Math.max(...losses) : undefined,
      series,
    });
  }
}

export const callRecorder = new CallRecorder();
