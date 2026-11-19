import {
  createEffect,
  createSignal,
  mergeProps,
  onCleanup,
  onMount,
  splitProps,
} from "solid-js";
import { spread } from "solid-js/web";

import {
  type VideoTrackProps,
  VideoTrack,
  useEnsureTrackRef,
  useMediaTrackBySourceOrName,
} from "solid-livekit-components";

/**
 * Drop-in replacement for `VideoTrack` from solid-livekit-components.
 *
 * Remote tracks still use the original `VideoTrack` (they paint fine, and it
 * keeps the visibility based subscription handling). Local tracks (own camera
 * and own screen share preview) are drawn into a hand-made `<video>`, see
 * `LocalVideoTrack`.
 */
export function CallVideoTrack(props: VideoTrackProps) {
  const trackReference = useEnsureTrackRef(props.trackRef);

  // the local/remote choice is intentionally fixed at creation: a track
  // reference never changes its participant
  return trackReference.participant.isLocal ? (
    <LocalVideoTrack {...props} />
  ) : (
    <VideoTrack {...props} />
  );
}

/**
 * Renders a local capture track into a `<video>` made by
 * `document.createElement`.
 *
 * Why: WebKit (iPhone Safari) doesn't paint a local capture MediaStream into a
 * `<video>` that was made by cloning a template. Solid's JSX `<video>` compiles
 * to exactly that, so VideoTrack shows a blank tile for the own camera on iOS
 * (the track is live and plays, but nothing is drawn). Remote tracks aren't
 * affected. It does what VideoTrack does otherwise: attaches the LiveKit track,
 * sets the orientation/source data attributes and forwards class, style, ref
 * and event props.
 */
function LocalVideoTrack(props: VideoTrackProps) {
  const [local, rest] = splitProps(props, [
    "trackRef",
    "onTrackClick",
    "onClick",
    "onSubscriptionStatusChanged",
    "manageSubscription",
  ]);

  const trackReference = useEnsureTrackRef(local.trackRef);

  // created by hand on purpose, see the doc comment above
  const mediaEl = document.createElement("video");
  mediaEl.muted = true;
  mediaEl.playsInline = true;
  mediaEl.setAttribute("playsinline", "");
  onCleanup(() => {
    mediaEl.srcObject = null;
  });
  const [element, setElement] = createSignal<HTMLVideoElement>();
  onMount(() => setElement(mediaEl));

  const { elementProps, publication, isSubscribed } =
    useMediaTrackBySourceOrName(trackReference, {
      element: element,
      // @ts-expect-error same typing gap as in VideoTrack
      props: rest,
    });

  createEffect(() => {
    local.onSubscriptionStatusChanged?.(!!isSubscribed());
  });

  // applies class, style, data attributes, ref and `on:` handlers reactively
  spread(
    mediaEl,
    mergeProps(elementProps, {
      muted: true,
      onClick: (evt: MouseEvent) => {
        (local.onClick as ((evt: MouseEvent) => void) | undefined)?.(evt);
        local.onTrackClick?.({
          participant: trackReference?.participant,
          track: publication(),
        });
      },
    }),
    false,
    false,
  );

  return mediaEl;
}
