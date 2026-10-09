import {
  Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { AudioTrack, useTracks } from "solid-livekit-components";

import { getTrackReferenceId, isLocal } from "@livekit/components-core";
import { Key } from "@solid-primitives/keyed";
import { RemoteTrackPublication, Track, TrackEvent } from "livekit-client";

import { useState } from "@revolt/state";

import { addTrack, isBusMode } from "../outputBus";
import { useVoice } from "../state";
import { createVolumeBoost, setBoostOutputDevice } from "../volumeBoost";

/**
 * Whether call audio plays through the output bus (Safari), where the track
 * elements stay attached but silent
 */
const busMode = isBusMode();

/**
 * Play a remote track through the output bus, following it through
 * resubscriptions
 * @param publication Track publication
 * @param gain Loudness (1 is full volume, 0 is silent)
 * @param muted Whether the track is muted, which also stops receiving it
 * @returns The current media track
 */
function createBusPlayback(
  publication: Accessor<RemoteTrackPublication>,
  gain: Accessor<number>,
  muted: Accessor<boolean>,
) {
  const [mediaTrack, setMediaTrack] = createSignal<MediaStreamTrack>();
  const [busTrack, setBusTrack] = createSignal<ReturnType<typeof addTrack>>();

  createEffect(() => {
    const pub = publication();
    const update = () => setMediaTrack(pub.track?.mediaStreamTrack);

    update();
    pub.on(TrackEvent.Subscribed, update);
    pub.on(TrackEvent.Unsubscribed, update);

    onCleanup(() => {
      pub.off(TrackEvent.Subscribed, update);
      pub.off(TrackEvent.Unsubscribed, update);
    });
  });

  createEffect(() => {
    const track = mediaTrack();
    if (!track) return;

    const bus = addTrack(track);
    setBusTrack(bus);

    onCleanup(() => {
      setBusTrack(undefined);
      bus.remove();
    });
  });

  createEffect(() => busTrack()?.setGain(gain()));

  // like AudioTrack's muted prop: the server stops sending muted tracks
  createEffect(() => publication().setEnabled(!muted()));

  return mediaTrack;
}

/**
 * Plays the call's remote audio
 */
export function RoomAudioManager() {
  const voice = useVoice();
  const state = useState();

  const tracks = useTracks(
    [
      Track.Source.Microphone,
      Track.Source.ScreenShareAudio,
      Track.Source.Unknown,
    ],
    {
      updateOnlyOn: [],
      onlySubscribed: false,
    },
  );

  const filteredTracks = createMemo(() =>
    tracks().filter(
      (track) =>
        !isLocal(track.participant) &&
        track.publication.kind === Track.Kind.Audio &&
        // stream audio only plays while we watch that stream
        (track.source !== Track.Source.ScreenShareAudio ||
          voice.watching.has(track.participant.identity)),
    ),
  );

  createEffect(() => {
    const tracks = filteredTracks();
    console.info("[rtc] filtered tracks", filteredTracks());
    for (const track of tracks) {
      (track.publication as RemoteTrackPublication).setSubscribed(true);
      console.info(track.publication);
    }
  });

  createEffect(() => {
    if (!busMode) setBoostOutputDevice(state.voice.preferredAudioOutputDevice);
  });

  return (
    <div style={{ display: "none" }}>
      <Key each={filteredTracks()} by={(item) => getTrackReferenceId(item)}>
        {(track) => {
          const isStream = () =>
            track().source === Track.Source.ScreenShareAudio;

          const volume = () =>
            state.voice.outputVolume *
            (isStream()
              ? state.voice.getScreenShareVolume(track().participant.identity)
              : state.voice.getUserVolume(track().participant.identity));

          const muted = () =>
            (isStream()
              ? state.voice.getScreenShareMuted(track().participant.identity)
              : state.voice.getUserMuted(track().participant.identity)) ||
            voice.deafen();

          if (busMode) {
            // the bus plays the track. Safari only delivers audio of remote
            // tracks attached to an element, so the track also gets an
            // element of its own that always stays muted (LiveKit's
            // AudioTrack unmutes its element again)
            const mediaTrack = createBusPlayback(
              () => track().publication as RemoteTrackPublication,
              () => (muted() ? 0 : volume()),
              muted,
            );
            let el: HTMLAudioElement | undefined;
            createEffect(() => {
              const t = mediaTrack();
              if (!el) return;
              el.muted = true;
              el.srcObject = t ? new MediaStream([t]) : null;
            });

            onCleanup(() => {
              if (el) el.srcObject = null;
            });

            return <audio ref={el} autoplay muted aria-hidden="true" />;
          }

          // above 100% the boost plays the track instead of the element
          const boosted = createVolumeBoost(
            () => track().publication as RemoteTrackPublication,
            volume,
          );

          return (
            <AudioTrack
              trackRef={track()}
              volume={boosted() ? 0 : Math.min(volume(), 1)}
              muted={muted()}
            />
          );
        }}
      </Key>
    </div>
  );
}
