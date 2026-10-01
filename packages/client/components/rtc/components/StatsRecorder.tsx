import { createEffect, onCleanup } from "solid-js";

import { Room, Track } from "livekit-client";

import { useClient } from "@revolt/client";
import { useState } from "@revolt/state";

import { useVoice } from "../state";
import { STATS_INTERVAL_MS, TrackDescriptor, statsRecorder } from "../stats";

/**
 * Samples call video statistics while developer mode is on
 */
export function StatsRecorder() {
  const state = useState();
  const voice = useVoice();
  const client = useClient();

  /**
   * Every video track we publish or receive right now
   */
  function describeTracks(room: Room): TrackDescriptor[] {
    const channel = voice.channel();
    const context = {
      channelName: channel?.name,
      serverName: channel?.server?.name,
    };

    const name = (id: string) => {
      const user = client().users.get(id);
      return user?.displayName ?? user?.username ?? id;
    };

    const tracks: TrackDescriptor[] = [];

    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      const track = pub.track;
      if (!track) continue;
      tracks.push({
        ...context,
        key: pub.trackSid,
        direction: "sending",
        source: pub.source ?? Track.Source.Unknown,
        participantId: room.localParticipant.identity,
        participantName: name(room.localParticipant.identity),
        getStats: () => track.getRTCStatsReport(),
      });
    }

    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.videoTrackPublications.values()) {
        const track = pub.track;
        if (!track) continue;
        tracks.push({
          ...context,
          key: pub.trackSid,
          direction: "receiving",
          source: pub.source ?? Track.Source.Unknown,
          participantId: participant.identity,
          participantName: name(participant.identity),
          getStats: () => track.getRTCStatsReport(),
        });
      }
    }

    return tracks;
  }

  createEffect(() => {
    const room = voice.room();
    if (!room || !state.settings.getValue("advanced:developer_mode")) return;

    let busy = false;
    const interval = setInterval(async () => {
      // skip a tick rather than pile up if stats are slow
      if (busy) return;
      busy = true;
      try {
        await statsRecorder.tick(describeTracks(room));
      } finally {
        busy = false;
      }
    }, STATS_INTERVAL_MS);

    onCleanup(() => {
      clearInterval(interval);
      statsRecorder.flush();
    });
  });

  return null;
}
