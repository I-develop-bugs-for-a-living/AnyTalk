import { For, Show, createMemo } from "solid-js";
import { useTrackRefContext } from "solid-livekit-components";

import { styled } from "styled-system/jsx";

import { formatBitrate, layerName, statsRecorder } from "@revolt/rtc/stats";

type Line = [label: string, value: string];

const ms = (v?: number) => (v !== undefined ? `${Math.round(v)} ms` : "-");

/**
 * Live WebRTC statistics overlay for a participant tile (developer mode)
 */
export function TrackStats() {
  const trackRef = useTrackRefContext();

  const lines = createMemo((): Line[] => {
    const sid = trackRef.publication?.trackSid;
    const entry = sid ? statsRecorder.latest()[sid] : undefined;
    if (!entry) return [];

    const { sample: s, info, direction } = entry;
    const out: Line[] = [];

    if (direction === "sending") {
      out.push(["Direction", "Sending"]);
      for (const layer of info.layers ?? []) {
        out.push([layerName(layer.rid), layer.text]);
      }
      out.push(
        ["Limited by", s.limitation ?? "-"],
        [
          "Target",
          s.targetBitrate !== undefined ? formatBitrate(s.targetBitrate) : "-",
        ],
        ["Encoder", info.encoder ?? "-"],
        ["Keyframe requests /s", String(s.pli ?? 0)],
        ["Resend requests /s", String(s.nack ?? 0)],
        ["Lost on way to server /s", String(s.lost ?? 0)],
      );
    } else {
      out.push(
        ["Direction", "Receiving"],
        [
          "Video",
          s.width ? `${s.width}x${s.height} @ ${s.fps ?? 0} fps` : "no frames",
        ],
        ["Bitrate", s.bitrate !== undefined ? formatBitrate(s.bitrate) : "-"],
        ["Codec", info.codec ?? "-"],
        ["Decoder", info.decoder ?? "-"],
        ["Frozen /s", `${(s.frozen ?? 0).toFixed(2)} s`],
        ["Packets lost / received /s", `${s.lost ?? 0} / ${s.received ?? 0}`],
        ["Dropped /s", String(s.dropped ?? 0)],
        ["Keyframe requests /s", String(s.pli ?? 0)],
        ["Resend requests /s", String(s.nack ?? 0)],
        ["Jitter", ms(s.jitter)],
        ["Jitter buffer", ms(s.jitterBuffer)],
      );
    }

    out.push(["Ping", ms(s.rtt)], ["Transport", info.transport ?? "-"]);
    if (s.available !== undefined) {
      out.push([
        direction === "sending" ? "Est. upload" : "Est. download",
        formatBitrate(s.available),
      ]);
    }

    return out;
  });

  return (
    <Show when={lines().length}>
      <Stats>
        <For each={lines()}>
          {([label, value]) => (
            <>
              <span>{label}</span>
              <span>{value}</span>
            </>
          )}
        </For>
      </Stats>
    </Show>
  );
}

const Stats = styled("div", {
  base: {
    gridArea: "1/1",
    alignSelf: "start",
    justifySelf: "start",
    zIndex: 1,
    margin: "var(--gap-sm)",
    padding: "var(--gap-sm) var(--gap-md)",

    display: "grid",
    gridTemplateColumns: "auto auto",
    columnGap: "var(--gap-md)",

    pointerEvents: "none",
    borderRadius: "var(--borderRadius-md)",
    background: "#000c",
    color: "white",
    fontFamily: "var(--fonts-monospace)",
    fontSize: "11px",
    lineHeight: 1.4,
    whiteSpace: "nowrap",
  },
});
