import { useLingui } from "@lingui/solid/macro";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { TrackLoop } from "solid-livekit-components";

import { Track } from "livekit-client";
import { styled } from "styled-system/jsx";

import { useDevice } from "@revolt/common";
import { InRoom, useVoice } from "@revolt/rtc";
import { IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";
import { scrollableStyles } from "@revolt/ui/directives";

import { ParticipantInfo, ParticipantTile, tile } from "./ParticipantTile";
import { VoiceCallCardActions } from "./VoiceCallCardActions";
import {
  VoiceCallCardEnableAudio,
  VoiceCallCardStatus,
} from "./VoiceCallCardStatus";

/**
 * Call card (active)
 */
export function VoiceCallCardActiveRoom() {
  const voice = useVoice();
  const collapsed = createMemo(() => voice.layout() === "collapsed");

  // Fullscreen with a focused stream: video fills the screen and the
  // controls float on top, fading out while the mouse is idle
  const theater = createMemo(
    () =>
      voice.layout() === "fullscreen" &&
      (!!voice.focusId() || voice.isMultiStream()),
  );

  const [idle, setIdle] = createSignal(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function wake() {
    setIdle(false);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setIdle(true), THEATER_IDLE_MS);
  }

  /** Hide the controls right away, e.g. when the window loses focus */
  function sleep() {
    clearTimeout(idleTimer);
    setIdle(true);
  }

  createEffect(() => {
    if (theater()) wake();
  });

  onMount(() => {
    window.addEventListener("blur", sleep);
    document.documentElement.addEventListener("mouseleave", sleep);
  });

  onCleanup(() => {
    clearTimeout(idleTimer);
    window.removeEventListener("blur", sleep);
    document.documentElement.removeEventListener("mouseleave", sleep);
  });

  return (
    <View
      collapsed={collapsed()}
      theater={theater()}
      hideCursor={theater() && idle()}
      onPointerMove={() => theater() && wake()}
      onPointerLeave={() => theater() && sleep()}
    >
      <Show when={!collapsed()}>
        <VoiceCallCardEnableAudio />
      </Show>
      <Participants theater={theater()} />
      <VoiceCallControls theater={theater()} hidden={theater() && idle()}>
        <VoiceCallControlHolder left collapsed={collapsed()}>
          <VoiceCallCardStatus />
          <Show when={theater() && voice.focusTrack()}>
            <FocusedInfo>
              <TrackLoop tracks={() => [voice.focusTrack()!]}>
                {() => <ParticipantInfo align="start" />}
              </TrackLoop>
            </FocusedInfo>
          </Show>
        </VoiceCallControlHolder>
        <VoiceCallCardActions size="sm" />
        <VoiceCallControlHolder right collapsed={collapsed()}>
          <LayoutButtons />
        </VoiceCallControlHolder>
      </VoiceCallControls>
    </View>
  );
}

function LayoutButtons() {
  const voice = useVoice();
  const device = useDevice();
  const { t } = useLingui();

  return (
    <>
      <Show when={device.layout() === "desktop"}>
        <IconButton
          size="sm"
          variant="standard"
          onPress={() => voice.toggleLayout("collapsed")}
          use:floating={{
            tooltip: {
              placement: "top",
              content: t`Collapse call window`,
            },
          }}
        >
          <Symbol>unfold_less</Symbol>
        </IconButton>
        <IconButton
          size="sm"
          variant="standard"
          onPress={() => voice.toggleLayout("expanded")}
          use:floating={{
            tooltip: {
              placement: "top",
              content:
                voice.layout() === "expanded"
                  ? t`Restore call window`
                  : t`Maximize call window`,
            },
          }}
        >
          <Show
            when={voice.layout() === "expanded"}
            fallback={<Symbol>open_in_full</Symbol>}
          >
            <Symbol>close_fullscreen</Symbol>
          </Show>
        </IconButton>
      </Show>
      <IconButton
        size="sm"
        variant={"standard"}
        onPress={() => voice.toggleLayout("fullscreen")}
      >
        <Show
          when={voice.layout() === "fullscreen"}
          fallback={<Symbol>fullscreen</Symbol>}
        >
          <Symbol>fullscreen_exit</Symbol>
        </Show>
      </IconButton>
    </>
  );
}

const THEATER_IDLE_MS = 2500;

const TILE_MIN_WIDTH = "250px",
  TILE_MIN_FOCUS_HEIGHT = "100px";

/**
 * Show a grid of participants
 */
function Participants(props: { theater: boolean }) {
  const voice = useVoice();
  const { t } = useLingui();

  // Modify this value to get test tracks
  const testTrackCount = 0;

  let callRef: HTMLDivElement | undefined;

  const tileWidth = () => {
    const vidWidth = Math.round(
      100 / (voice.vidTracks().length + testTrackCount),
    );
    return `max(${TILE_MIN_WIDTH}, ${vidWidth}% - var(--gap-md))`;
  };

  // Several streams open: tile them, and only list the other streams below
  const multi = createMemo(() => voice.isMultiStream());
  const hasMain = () => multi() || !!voice.focusId();
  const others = () =>
    multi()
      ? voice
          .vidTracks()
          .filter(
            (t) =>
              t.source === Track.Source.ScreenShare &&
              !voice.isWatchedStream(t),
          )
      : voice.vidTracks().filter((t) => !voice.isFocus(t));

  // Clear out any focus when the track that was focused is no longer available.
  createEffect(() => {
    if (!voice.focusTrack()) voice.toggleFocus();
  });

  // Focus a stream we just started watching, once its track is listed
  createEffect(() => {
    const identity = voice.pendingFocus();
    if (!identity) return;
    const track = voice
      .vidTracks()
      .find(
        (t) =>
          t.source === Track.Source.ScreenShare &&
          t.participant.identity === identity,
      );
    if (track) {
      voice.setFocusTrack(track);
      voice.clearPendingFocus();
    }
  });

  onMount(() => {
    createResizeObserver(callRef, ({ width, height }, el) => {
      if (el === callRef) {
        el.style.setProperty("--vc-w", `${width}px`);
        el.style.setProperty("--vc-h", `${height}px`);
      }
    });
  });

  return (
    <Call ref={callRef} class={hasMain() ? "" : scrollableStyles()}>
      <InRoom>
        <Show
          when={multi()}
          fallback={<FocusedParticipant theater={props.theater} />}
        >
          <StreamTiling />
        </Show>
        <Show when={hasMain() && !props.theater && others().length}>
          <ShowBarButtonHolder>
            <div style={{ "margin-bottom": "10px" }}>
              <IconButton
                size="xs"
                variant={"tonal"}
                onPress={() => voice.toggleShowBar()}
                use:floating={{
                  tooltip: {
                    placement: "top",
                    content: voice.showBar() ? t`Hide Others` : t`Show Others`,
                  },
                }}
              >
                <Show
                  when={voice.showBar()}
                  fallback={<Symbol>keyboard_arrow_up</Symbol>}
                >
                  <Symbol>keyboard_arrow_down</Symbol>
                </Show>
              </IconButton>
            </div>
          </ShowBarButtonHolder>
        </Show>
        <Grid
          focus={hasMain()}
          show={voice.showBar() && !props.theater}
          class={hasMain() ? scrollableStyles({ direction: "x" }) : ""}
          style={{ "--vc-tile-width": tileWidth() }}
        >
          <TrackLoop tracks={others}>{() => <ParticipantTile />}</TrackLoop>
          <For each={Array(testTrackCount)}>
            {() => (
              <div
                class={
                  tile({ fullscreen: voice.layout() === "fullscreen" }) +
                  " vc_tile"
                }
              />
            )}
          </For>
        </Grid>
      </InRoom>
    </Call>
  );
}

/**
 * Open streams split across the call window like a tiling window manager:
 * as square a grid as possible, with the last row stretched to fill
 */
function StreamTiling() {
  const voice = useVoice();

  const rows = createMemo(() => {
    const streams = voice.watchedStreams();
    const columns = Math.ceil(Math.sqrt(streams.length));
    const out: (typeof streams)[] = [];
    for (let i = 0; i < streams.length; i += columns) {
      out.push(streams.slice(i, i + columns));
    }
    return out;
  });

  return (
    <Tiling>
      <For each={rows()}>
        {(row) => (
          <TilingRow>
            <TrackLoop tracks={() => row}>
              {() => <ParticipantTile fill />}
            </TrackLoop>
          </TilingRow>
        )}
      </For>
    </Tiling>
  );
}

function FocusedParticipant(props: { theater: boolean }) {
  const voice = useVoice();

  return (
    <Show when={voice.focusTrack()}>
      <TrackLoop tracks={() => [voice.focusTrack()!]}>
        {() => (
          <FocusBox theater={props.theater}>
            <ParticipantTile focus />
          </FocusBox>
        )}
      </TrackLoop>
    </Show>
  );
}

const View = styled("div", {
  base: {
    minHeight: 0,
    height: "100%",
    width: "100%",

    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "var(--gap-md)",
    padding: "var(--gap-md)",
    transition: "padding var(--transitions-medium)",
  },
  variants: {
    collapsed: {
      true: { padding: 0 },
    },
    theater: {
      true: {
        position: "relative",
        padding: 0,
        gap: 0,
        background: "black",
      },
    },
    hideCursor: {
      true: { cursor: "none" },
    },
  },
});

const VoiceCallControls = styled("div", {
  base: {
    display: "flex",
    flexShrink: 0,
    overflow: "hidden",

    _phone: {
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--gap-sm)",
    },
  },
  variants: {
    theater: {
      true: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1,
        color: "white",
        background: "linear-gradient(transparent, #000a)",
        transition: "opacity var(--transitions-medium)",
      },
    },
    hidden: {
      true: {
        opacity: 0,
        pointerEvents: "none",
      },
    },
  },
});

const VoiceCallControlHolder = styled("div", {
  base: {
    display: "flex",
    flex: 1,
    alignSelf: "center",
    gap: "var(--gap-md)",
    padding: "var(--gap-md)",
    opacity: 1,
    transition: "opacity var(--transitions-medium)",

    // On phones the call buttons get the width, the sides only fit theirs
    _phone: {
      flex: "0 0 auto",
      padding: "var(--gap-sm)",
    },
  },
  variants: {
    left: {
      true: {
        justifyContent: "flex-start",
        overflow: "hidden",
      },
    },
    right: {
      true: {
        justifyContent: "flex-end",
      },
    },
    collapsed: {
      true: {
        opacity: 0,
        pointerEvents: "none",
      },
    },
  },
});

const FocusedInfo = styled("div", {
  base: {
    minWidth: 0,
    alignSelf: "center",
    fontWeight: 600,
  },
});

const ShowBarButtonHolder = styled("div", {
  base: {
    height: 0,
    alignSelf: "center",
    overflow: "visible",
    display: "flex",
    flexDirection: "column-reverse",
  },
});

const Call = styled("div", {
  base: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    flexGrow: 1,
    minHeight: 0,
  },
});

const Grid = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "safe center",
    alignContent: "safe center",
    minHeight: "100%",
    gap: "var(--gap-md)",
  },

  variants: {
    focus: {
      true: {
        flexDirection: "column",
        height: `max(20%, ${TILE_MIN_FOCUS_HEIGHT})`,
        minHeight: 0,
        transition: "height .3s ease",

        "& .vc_tile": {
          width: "auto",
          height: "100%",
        },
      },
    },
    show: {
      false: {
        height: 0,
      },
    },
  },
});

const Tiling = styled("div", {
  base: {
    height: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
  },
});

const TilingRow = styled("div", {
  base: {
    flex: "1 1 0",
    minHeight: 0,
    display: "flex",
    gap: "var(--gap-sm)",
  },
});

const FocusBox = styled("div", {
  base: {
    height: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    margin: "0 auto",
  },
  variants: {
    theater: {
      true: {
        width: "100%",
        margin: 0,
      },
    },
  },
});
