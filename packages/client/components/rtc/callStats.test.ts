import { describe, expect, test, vi } from "vitest";

import {
  AudioParser,
  CallRecorder,
  callRecaps,
  summariseAudio,
} from "./callStats";
import { TrackDescriptor } from "./stats";

type Report = RTCStats & Record<string, unknown>;

const codec: Report = {
  id: "C",
  type: "codec",
  timestamp: 0,
  mimeType: "audio/opus",
};

describe("AudioParser (receiving)", () => {
  const inbound = (timestamp: number, fields: Record<string, number>) =>
    ({
      id: "IN",
      type: "inbound-rtp",
      kind: "audio",
      timestamp,
      codecId: "C",
      ...fields,
    }) as Report;

  test("turns cumulative counters into per-interval values", () => {
    const parser = new AudioParser();

    parser.parse(
      [
        codec,
        inbound(1000, {
          bytesReceived: 0,
          packetsReceived: 0,
          packetsLost: 0,
          concealedSamples: 0,
          totalSamplesReceived: 0,
          jitterBufferDelay: 0,
          jitterBufferEmittedCount: 0,
        }),
      ],
      0,
    );

    const { sample, codec: mime } = parser.parse(
      [
        codec,
        inbound(2000, {
          bytesReceived: 4000,
          packetsReceived: 48,
          packetsLost: 2,
          concealedSamples: 4800,
          totalSamplesReceived: 48000,
          jitterBufferDelay: 2.4,
          jitterBufferEmittedCount: 48000,
          jitter: 0.012,
          audioLevel: 0.3,
        }),
      ],
      1000,
    );

    expect(sample.bitrate).toBe(32_000);
    expect(sample.packets).toBe(48);
    expect(sample.lost).toBe(2);
    expect(sample.concealed).toBeCloseTo(0.1);
    expect(sample.jitterBuffer).toBeCloseTo(0.05);
    expect(sample.jitter).toBeCloseTo(12);
    expect(sample.level).toBe(0.3);
    expect(mime).toBe("audio/opus");
  });
});

describe("AudioParser (sending)", () => {
  test("reads what the server reports about our packets", () => {
    const parser = new AudioParser();
    const reports = (timestamp: number, sent: number, lost: number) =>
      [
        {
          id: "OUT",
          type: "outbound-rtp",
          kind: "audio",
          timestamp,
          bytesSent: sent * 80,
          packetsSent: sent,
        },
        {
          id: "RIN",
          type: "remote-inbound-rtp",
          kind: "audio",
          timestamp,
          packetsLost: lost,
          jitter: 0.004,
          roundTripTime: 0.05,
        },
        {
          id: "SRC",
          type: "media-source",
          kind: "audio",
          timestamp,
          audioLevel: 0.5,
        },
      ] as Report[];

    parser.parse(reports(1000, 0, 0), 0);
    const { sample } = parser.parse(reports(2000, 50, 1), 1000);

    expect(sample.bitrate).toBe(32_000);
    expect(sample.packets).toBe(50);
    expect(sample.lost).toBe(1);
    expect(sample.jitter).toBeCloseTo(4);
    expect(sample.rtt).toBeCloseTo(50);
    expect(sample.level).toBe(0.5);
  });
});

describe("summariseAudio", () => {
  test("averages rates and works out packet loss", () => {
    const summary = summariseAudio([
      { t: 0, bitrate: 30_000, packets: 49, lost: 1, jitter: 10, rtt: 40 },
      { t: 1000, bitrate: 34_000, packets: 50, lost: 0, jitter: 20, rtt: 60 },
    ]);

    expect(summary.avgBitrate).toBe(32_000);
    expect(summary.loss).toBeCloseTo(0.01);
    expect(summary.avgJitter).toBe(15);
    expect(summary.maxJitter).toBe(20);
    expect(summary.maxRtt).toBe(60);
  });
});

describe("CallRecorder", () => {
  const mic = (
    key: string,
    direction: "sending" | "receiving",
  ): TrackDescriptor => ({
    key,
    direction,
    source: "microphone",
    participantId: key,
    participantName: key.toUpperCase(),
    getStats: async () =>
      new Map([
        [
          "R",
          {
            id: "R",
            type: direction === "sending" ? "outbound-rtp" : "inbound-rtp",
            kind: "audio",
            timestamp: Date.now(),
          },
        ],
      ]) as unknown as RTCStatsReport,
  });

  test("feeds the overlay but saves nothing when not recording", async () => {
    const save = vi.spyOn(callRecaps, "save").mockResolvedValue();
    const recorder = new CallRecorder();

    for (let i = 0; i < 6; i++) {
      await recorder.tick({}, [mic("me", "sending")], { record: false });
    }
    expect(recorder.latest().me.direction).toBe("sending");

    await recorder.flush();
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  test("saves the call with one series per microphone", async () => {
    const save = vi.spyOn(callRecaps, "save").mockResolvedValue();
    const recorder = new CallRecorder();

    for (let i = 0; i < 6; i++) {
      await recorder.tick(
        { channelName: "General" },
        [mic("me", "sending"), mic("bob", "receiving")],
        { record: true },
      );
    }
    await recorder.flush();

    expect(save).toHaveBeenCalledOnce();
    const recap = save.mock.calls[0][0];
    expect(recap.channelName).toBe("General");
    expect(recap.participants).toEqual(["BOB"]);
    expect(recap.series.map((s) => s.data.length)).toEqual([6, 6]);
    save.mockRestore();
  });

  test("records LiveKit's connection quality", async () => {
    const save = vi.spyOn(callRecaps, "save").mockResolvedValue();
    const recorder = new CallRecorder();
    const ratings = ["excellent", "good", "poor", "lost", "poor", "excellent"];

    for (const rating of ratings) {
      await recorder.tick(
        {},
        [{ ...mic("bob", "receiving"), connectionQuality: () => rating }],
        { record: true },
      );
    }
    await recorder.flush();

    const [series] = save.mock.calls[0][0].series;
    expect(series.data.map((s) => s.quality)).toEqual([3, 2, 1, 0, 1, 3]);
    expect(series.summary.poorConnection).toBeCloseTo(0.5);
    save.mockRestore();
  });
});
