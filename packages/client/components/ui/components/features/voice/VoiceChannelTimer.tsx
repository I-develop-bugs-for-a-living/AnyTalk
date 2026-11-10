import { Show, createMemo } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { Channel } from "stoat.js";
import { styled } from "styled-system/jsx";

import { typography } from "../../design";

import {
  formatElapsed,
  trackOccupancy,
  useOccupancyMount,
  useSharedNow,
} from "./voiceTimer";

/**
 * Elapsed time since the voice channel became occupied (like "41:50"),
 * hidden while nobody is in it. Designed for the right of a sidebar channel row.
 */
export function VoiceChannelTimer(props: { channel: Channel }) {
  const { t } = useLingui();
  const now = useSharedNow();
  // eslint-disable-next-line solid/reactivity -- a timer belongs to one channel
  useOccupancyMount(props.channel.id);

  // start is derived from the participants' server-provided join times
  const start = createMemo(() => {
    const joinedAts = [...props.channel.voiceParticipants.values()].map((p) =>
      p.joinedAt.getTime(),
    );
    return trackOccupancy(props.channel.id, joinedAts);
  });

  const elapsed = () => Math.max(0, now() - start()!);
  const time = () => formatElapsed(elapsed());

  return (
    <Show when={start() !== undefined}>
      <Time dateTime={`PT${Math.floor(elapsed() / 1000)}S`}>
        {/* read on demand by screen readers, never announced each second */}
        <HiddenText>{t`In call for ${time()}`}</HiddenText>
        <Digits aria-hidden="true">{time()}</Digits>
      </Time>
    </Show>
  );
}

/**
 * Small muted tabular timer text, pushed to the end of the row
 */
const Time = styled("time", {
  base: {
    ...typography.raw({ class: "label", size: "small" }),
    flexShrink: 0,
    marginInlineStart: "auto",
    fontVariantNumeric: "tabular-nums",
    color: "var(--md-sys-color-outline)",
  },
});

/**
 * Digits kept in one left-to-right run so they don't reorder in RTL
 */
const Digits = styled("span", {
  base: { unicodeBidi: "isolate", direction: "ltr" },
});

/**
 * Text only for screen readers
 */
const HiddenText = styled("span", {
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
