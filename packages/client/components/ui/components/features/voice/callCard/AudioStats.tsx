import { For, Show, createMemo } from "solid-js";
import { useEnsureParticipant } from "solid-livekit-components";

import { styled } from "styled-system/jsx";

import { callRecorder } from "@revolt/rtc/callStats";
import { formatBitrate } from "@revolt/rtc/stats";

import { useConnectionQuality } from "./ConnectionQualityIcon";

type Line = [label: string, value: string];

const ms = (v?: number) => (v !== undefined ? `${Math.round(v)} ms` : "-");
const percent = (v?: number) =>
  v !== undefined ? `${(v * 100).toFixed(1)}%` : "-";

/**
 * Live microphone statistics overlay for a participant tile (voice developer
 * mode): what we send for our own tile, what we receive for everyone else's
 */
export function AudioStats() {
  const participant = useEnsureParticipant();
  const quality = useConnectionQuality(participant);

  const lines = createMemo((): Line[] => {
    const entry = callRecorder.latest()[participant.identity];
    if (!entry) return [];

    const { sample: s, codec, direction } = entry;
    const lossOf = (lost = 0, packets = 0) =>
      lost + packets ? percent(lost / (lost + packets)) : "-";

    const out: Line[] = [
      ["Mic", direction === "sending" ? "Sending" : "Receiving"],
      ["Connection", quality()],
      ["Bitrate", s.bitrate !== undefined ? formatBitrate(s.bitrate) : "-"],
      ["Loss", lossOf(s.lost, s.packets)],
      ["Jitter", ms(s.jitter)],
    ];

    if (direction === "receiving") {
      out.push(
        ["Jitter buffer", ms(s.jitterBuffer)],
        ["Concealed", percent(s.concealed)],
      );
    } else {
      out.push(["Ping", ms(s.rtt)]);
    }

    out.push(["Codec", codec?.replace(/^audio\//, "") ?? "-"]);
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
    justifySelf: "end",
    zIndex: 1,
    margin: "var(--gap-sm)",
    padding: "var(--gap-xs) var(--gap-sm)",

    display: "grid",
    gridTemplateColumns: "auto auto",
    columnGap: "var(--gap-md)",

    pointerEvents: "none",
    borderRadius: "var(--borderRadius-md)",
    background: "#000c",
    color: "white",
    fontFamily: "var(--fonts-monospace)",
    fontSize: "10px",
    lineHeight: 1.35,
    whiteSpace: "nowrap",
  },
});
