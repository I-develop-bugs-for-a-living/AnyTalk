import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  TrackReference,
  TrackReferenceOrPlaceholder,
  useIsMuted,
  VideoTrack,
} from "solid-livekit-components";

import { Trans, useLingui } from "@lingui/solid/macro";
import { Track } from "livekit-client";
import { styled } from "styled-system/jsx";

import { useUser } from "@revolt/markdown/users";
import { useSnackbar } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { useVoice } from "../state";

/** How long a stream may be missing before its window is closed */
const POPOUT_GRACE_MS = 2000;

/**
 * Renders the streams that were popped out into windows of their own, and
 * closes a window when its stream ends, is no longer watched or the call ends.
 *
 * Must stay mounted inside the room, the content is rendered into the popout
 * window through a portal so the app's contexts still reach it.
 */
export function StreamPopouts() {
  const voice = useVoice();

  /** Whether the stream of a popout is still there and watched */
  const alive = (id: string) => {
    const track = voice.vidTracks().find((t) => voice.trackId(t) === id);
    return (
      !!track &&
      (track.source !== Track.Source.ScreenShare ||
        voice.isWatchedStream(track))
    );
  };

  // A stream can vanish for a moment (a camera toggle, a source swap, a short
  // reconnect), so a missing track only closes its window if it is still
  // missing after a grace period
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  createEffect(() => {
    for (const id of [...voice.popouts.keys()]) {
      if (alive(id)) {
        clearTimeout(pending.get(id));
        pending.delete(id);
      } else if (!pending.has(id)) {
        pending.set(
          id,
          setTimeout(() => {
            pending.delete(id);
            if (!untrack(() => alive(id))) voice.closePopout(id);
          }, POPOUT_GRACE_MS),
        );
      }
    }
  });
  onCleanup(() => pending.forEach((timer) => clearTimeout(timer)));

  return (
    <For each={[...voice.popouts.keys()]}>
      {(id) => <PopoutWindow id={id} />}
    </For>
  );
}

/**
 * The content of one popout window
 */
function PopoutWindow(props: { id: string }) {
  const voice = useVoice();

  const popout = () => voice.popouts.get(props.id);
  const track = createMemo(() =>
    voice.vidTracks().find((t) => voice.trackId(t) === props.id),
  );

  return (
    <Show when={popout()} keyed>
      {(entry) => (
        <Show when={track()}>
          {(t) => (
            <Portal
              mount={entry.win.document.body}
              ref={(el) => {
                el.style.width = "100%";
                el.style.height = "100%";
              }}
            >
              <PopoutContent id={props.id} track={t()} />
            </Portal>
          )}
        </Show>
      )}
    </Show>
  );
}

/**
 * The stream filling a popout window, with a bar on hover or focus holding
 * the streamer's name, a fullscreen button and a button to bring it back.
 *
 * Uses native listeners (`on:click`): Solid's delegated events only listen
 * on the app's own document, they never fire inside another window.
 */
function PopoutContent(props: {
  id: string;
  track: TrackReferenceOrPlaceholder;
}) {
  const { t } = useLingui();
  const voice = useVoice();
  const snackbar = useSnackbar();
  // The track id holds the participant's session and the source, so both stay
  // the same for as long as this window exists: read them once
  const participant = untrack(() => props.track.participant);
  const source = untrack(() => props.track.source);
  const user = useUser(participant.identity);
  const isMuted = useIsMuted({ participant, source });

  let container: HTMLDivElement | undefined;
  let video: HTMLVideoElement | undefined;

  // LiveKit's observers live in the app's window and don't see this one: tell
  // it the video is shown, and when the window changes size, so the quality
  // follows (the patched livekit-client counts a video in another window as
  // visible)
  onMount(() => {
    type Observable = HTMLVideoElement & {
      handleResize?: () => void;
      handleVisibilityChanged?: (entry: unknown) => void;
    };
    const el = () => video as Observable | undefined;
    const kick = () => {
      el()?.handleVisibilityChanged?.({ target: video, isIntersecting: true });
      el()?.handleResize?.();
    };
    const win = container?.ownerDocument.defaultView;
    // after the video has been attached
    const timer = setTimeout(kick, 100);
    win?.addEventListener("resize", kick);
    onCleanup(() => {
      clearTimeout(timer);
      win?.removeEventListener("resize", kick);
    });
  });

  const [fullscreen, setFullscreen] = createSignal(false);
  // Chrome doesn't allow fullscreen in a Picture-in-Picture window
  const isPip = () => voice.popouts.get(props.id)?.kind === "pip";

  /** Fullscreen on whichever screen the window is on */
  const toggleFullscreen = () => {
    if (!container) return;
    const doc = container.ownerDocument;
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else void container.requestFullscreen().catch(() => {});
  };
  onMount(() => {
    const doc = container?.ownerDocument;
    if (!doc) return;
    const update = () => setFullscreen(!!doc.fullscreenElement);
    doc.addEventListener("fullscreenchange", update);
    onCleanup(() => doc.removeEventListener("fullscreenchange", update));
  });

  /**
   * Move the stream into a normal window. window.open has to be called in
   * this click before anything is awaited, or the browser blocks it.
   */
  const openAsWindow = async () => {
    const moved = await voice.reopenPopoutAsWindow(props.id);
    if (!moved) {
      snackbar.show({
        message: t`Could not open the stream in a separate window. Check that pop-ups are allowed.`,
      });
    }
  };

  return (
    <Container ref={container}>
      <Show
        when={!isMuted()}
        fallback={
          <Off role="status">
            <Trans>Camera is off</Trans>
          </Off>
        }
      >
        <VideoTrack
          style={{
            width: "100%",
            height: "100%",
            "object-fit": "contain",
            background: "black",
          }}
          ref={video}
          trackRef={props.track as TrackReference}
          // the main window decides what is subscribed
          manageSubscription={false}
        />
      </Show>
      <Bar data-popout-bar="">
        <Name>{user().username}</Name>
        <Show
          when={!isPip()}
          fallback={
            <BarButton
              type="button"
              aria-label={t`Open as window`}
              title={t`Open as window`}
              on:click={openAsWindow}
            >
              <Symbol size={20}>open_in_new</Symbol>
            </BarButton>
          }
        >
          <BarButton
            type="button"
            aria-label={fullscreen() ? t`Exit fullscreen` : t`Fullscreen`}
            title={fullscreen() ? t`Exit fullscreen` : t`Fullscreen`}
            on:click={toggleFullscreen}
          >
            <Symbol size={20}>
              {fullscreen() ? "fullscreen_exit" : "fullscreen"}
            </Symbol>
          </BarButton>
        </Show>
        <BarButton
          type="button"
          aria-label={t`Back to AnyTalk`}
          on:click={() => voice.closePopout(props.id)}
        >
          <Symbol size={20}>pip_exit</Symbol>
          <Trans>Back to AnyTalk</Trans>
        </BarButton>
      </Bar>
    </Container>
  );
}

/** Fills the window, shows the bar while hovered or holding focus */
const Container = styled("div", {
  base: {
    position: "relative",
    width: "100%",
    height: "100%",
    background: "black",
    color: "#fff",
    fontFamily: "var(--fonts-primary, sans-serif)",

    "&:hover [data-popout-bar], &:focus-within [data-popout-bar]": {
      opacity: 1,
    },
  },
});

/** Shown instead of the video while the camera is off */
const Off = styled("div", {
  base: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    textAlign: "center",
  },
});

/** Name and buttons along the top edge */
const Bar = styled("div", {
  base: {
    position: "absolute",
    insetInline: 0,
    insetBlockStart: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    background: "linear-gradient(rgb(0 0 0 / 0.7), transparent)",
    opacity: 0,
    transition: "opacity 0.15s ease",
  },
});

/** The streamer's name, shrinks before the buttons do */
const Name = styled("span", {
  base: {
    flex: "1 1 0",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 600,
  },
});

/**
 * Pill button of the bar. The popout is desktop-only (touch-only devices get
 * no pop out button), so these stay below the 44px touch target size.
 */
const BarButton = styled("button", {
  base: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 12px",
    border: "none",
    borderRadius: "999px",
    cursor: "pointer",
    font: "inherit",
    fontSize: "13px",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});
