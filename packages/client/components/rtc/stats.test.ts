import { describe, expect, test, vi } from "vitest";

import {
  Parser,
  StatsRecorder,
  TrackDescriptor,
  frozenTimeline,
  recaps,
  summarise,
} from "./stats";

type Report = RTCStats & Record<string, unknown>;

const pair = (rtt: number): Report[] => [
  { id: "T", type: "transport", timestamp: 0, selectedCandidatePairId: "P" },
  {
    id: "P",
    type: "candidate-pair",
    timestamp: 0,
    localCandidateId: "L",
    currentRoundTripTime: rtt,
    availableIncomingBitrate: 8_000_000,
  },
  {
    id: "L",
    type: "local-candidate",
    timestamp: 0,
    protocol: "udp",
    candidateType: "srflx",
  },
];

const inbound = (
  timestamp: number,
  fields: Record<string, number>,
): Report => ({
  id: "IN",
  type: "inbound-rtp",
  kind: "video",
  timestamp,
  frameWidth: 1920,
  frameHeight: 1080,
  framesPerSecond: 30,
  codecId: "C",
  ...fields,
});

const codec: Report = {
  id: "C",
  type: "codec",
  timestamp: 0,
  mimeType: "video/VP8",
};

describe("Parser (receiving)", () => {
  test("turns cumulative counters into per-interval deltas", () => {
    const parser = new Parser();

    parser.parse(
      [
        ...pair(0.04),
        codec,
        inbound(1000, {
          bytesReceived: 0,
          packetsLost: 10,
          packetsReceived: 1000,
          freezeCount: 1,
          totalFreezesDuration: 0.5,
        }),
      ],
      0,
    );

    const { sample, info } = parser.parse(
      [
        ...pair(0.05),
        codec,
        inbound(2000, {
          bytesReceived: 625_000,
          packetsLost: 13,
          packetsReceived: 1500,
          freezeCount: 2,
          totalFreezesDuration: 1.25,
          jitter: 0.012,
        }),
      ],
      1000,
    );

    expect(sample.bitrate).toBe(5_000_000);
    expect(sample.lost).toBe(3);
    expect(sample.received).toBe(500);
    expect(sample.freezes).toBe(1);
    expect(sample.frozen).toBeCloseTo(0.75);
    expect(sample.rtt).toBe(50);
    expect(sample.jitter).toBe(12);
    expect(sample.available).toBe(8_000_000);
    expect(info.codec).toBe("video/VP8");
    expect(info.transport).toBe("UDP / srflx");
  });

  test("ignores the receiving connection's upload estimate", () => {
    const [transport, candidatePair, local] = pair(0.04);
    const { sample } = new Parser().parse(
      [
        transport,
        {
          ...candidatePair,
          availableIncomingBitrate: undefined,
          availableOutgoingBitrate: 1_000_000_000,
        },
        local,
        inbound(1000, { bytesReceived: 100 }),
      ],
      0,
    );
    expect(sample.available).toBeUndefined();
  });

  test("has no deltas on the first report", () => {
    const { sample } = new Parser().parse(
      [inbound(1000, { bytesReceived: 100, packetsLost: 5 })],
      0,
    );
    expect(sample.bitrate).toBeUndefined();
    expect(sample.lost).toBeUndefined();
  });
});

describe("Parser (sending)", () => {
  const outbound = (
    rid: string,
    timestamp: number,
    fields: Record<string, unknown>,
  ): Report => ({
    id: `OUT-${rid}`,
    type: "outbound-rtp",
    kind: "video",
    rid,
    timestamp,
    ...fields,
  });

  test("sums active layers and reports the top layer", () => {
    const parser = new Parser();
    const layers = (timestamp: number, bytes: number) => [
      outbound("f", timestamp, {
        frameWidth: 1920,
        frameHeight: 1080,
        framesPerSecond: 60,
        bytesSent: bytes,
        qualityLimitationReason: "bandwidth",
        targetBitrate: 8_000_000,
      }),
      outbound("h", timestamp, { active: false, bytesSent: 0 }),
    ];

    parser.parse(layers(1000, 0), 0);
    const { sample, info } = parser.parse(layers(2000, 1_000_000), 1000);

    expect(sample.bitrate).toBe(8_000_000);
    expect(sample.activeLayers).toBe(1);
    expect(sample.width).toBe(1920);
    expect(sample.fps).toBe(60);
    expect(sample.limitation).toBe("bandwidth");
    expect(info.layers?.map((l) => l.text)).toEqual([
      "1920x1080 @ 60 fps, 8.00 Mbps",
      "paused",
    ]);
  });
});

describe("Parser (bandwidth estimate)", () => {
  test("uses the upload estimate for a sent track", () => {
    const [transport, candidatePair, local] = pair(0.04);
    const { sample } = new Parser().parse(
      [
        transport,
        { ...candidatePair, availableOutgoingBitrate: 6_000_000 },
        local,
        {
          id: "OUT",
          type: "outbound-rtp",
          kind: "video",
          timestamp: 1000,
          frameWidth: 1920,
          bytesSent: 0,
        },
      ],
      0,
    );
    expect(sample.available).toBe(6_000_000);
  });
});

describe("frozenTimeline", () => {
  test("marks every sample a freeze covered, not just where it ended", () => {
    expect(
      frozenTimeline([
        { t: 0 },
        { t: 1000, frozen: 0 },
        { t: 2000, frozen: 0 },
        { t: 3000, frozen: 0 },
        { t: 4000, frozen: 2.5 },
        { t: 5000, frozen: 0 },
        { t: 6000, frozen: 0.3 },
      ]),
    ).toEqual([undefined, 0, 1, 1, 1, 0, 1]);
  });
});

describe("summarise", () => {
  test("totals counters and averages rates", () => {
    const summary = summarise(
      [
        { t: 0, bitrate: 4_000_000, fps: 30, rtt: 40, lost: 1, received: 99 },
        {
          t: 1000,
          bitrate: 6_000_000,
          fps: 20,
          rtt: 60,
          freezes: 1,
          frozen: 0.4,
          received: 100,
          limitation: "cpu",
        },
      ],
      [{ transport: "UDP / host" }, { transport: "UDP / host" }],
    );

    expect(summary.avgBitrate).toBe(5_000_000);
    expect(summary.avgFps).toBe(25);
    expect(summary.freezes).toBe(1);
    expect(summary.frozenSeconds).toBeCloseTo(0.4);
    expect(summary.lost).toBe(1);
    expect(summary.received).toBe(199);
    expect(summary.maxRtt).toBe(60);
    expect(summary.limitation).toEqual({ cpu: 1 });
    expect(summary.transports).toEqual(["UDP / host"]);
  });
});

describe("StatsRecorder", () => {
  let bytes = 0;
  const track: TrackDescriptor = {
    key: "TR_1",
    direction: "receiving",
    source: "screen_share",
    participantId: "user",
    participantName: "User",
    getStats: async () => {
      bytes += 1000;
      const report = inbound(bytes, { bytesReceived: bytes });
      return new Map([[report.id, report]]) as unknown as RTCStatsReport;
    },
  };

  test("feeds the overlay but saves nothing when not recording", async () => {
    const save = vi.spyOn(recaps, "save").mockResolvedValue();
    const recorder = new StatsRecorder();

    for (let i = 0; i < 6; i++) await recorder.tick([track], { record: false });

    expect(recorder.latest()["TR_1"].sample.width).toBe(1920);
    await recorder.flush();
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  test("saves a recap when recording", async () => {
    const save = vi.spyOn(recaps, "save").mockResolvedValue();
    const recorder = new StatsRecorder();

    for (let i = 0; i < 6; i++) await recorder.tick([track], { record: true });

    await recorder.flush();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].data).toHaveLength(6);
    save.mockRestore();
  });
});
