import { createEffect, createMemo } from "solid-js";
import { AudioTrack, useTracks } from "solid-livekit-components";

import { getTrackReferenceId, isLocal } from "@livekit/components-core";
import { Key } from "@solid-primitives/keyed";
import { RemoteTrackPublication, Track } from "livekit-client";

import { useState } from "@revolt/state";

import { useVoice } from "../state";
import { createVolumeBoost, setBoostOutputDevice } from "../volumeBoost";

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

  createEffect(() =>
    setBoostOutputDevice(state.voice.preferredAudioOutputDevice),
  );

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

          // above 100% the boost plays the track instead of the element
          const boosted = createVolumeBoost(
            () => track().publication as RemoteTrackPublication,
            volume,
          );

          return (
            <AudioTrack
              trackRef={track()}
              volume={boosted() ? 0 : Math.min(volume(), 1)}
              muted={
                (isStream()
                  ? state.voice.getScreenShareMuted(
                      track().participant.identity,
                    )
                  : state.voice.getUserMuted(track().participant.identity)) ||
                voice.deafen()
              }
            />
          );
        }}
      </Key>
    </div>
  );
}
