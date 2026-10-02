import { createEffect, onCleanup } from "solid-js";

import { Room, Track } from "livekit-client";

import { useClient } from "@revolt/client";
import { useState } from "@revolt/state";

import { callRecorder } from "../callStats";
import { useVoice } from "../state";
import { STATS_INTERVAL_MS, TrackDescriptor, statsRecorder } from "../stats";

/**
 * Samples call statistics while a developer mode is on and either its live
 * overlay or recording is enabled: video while stream developer mode is on,
 * microphones while voice developer mode is on
 */
export function StatsRecorder() {
  const state = useState();
  const voice = useVoice();
  const client = useClient();

  /**
   * Every video track we publish or receive right now
   */
  const callContext = () => {
    const channel = voice.channel();
    return {
      channelName: channel?.name,
      serverName: channel?.server?.name,
    };
  };

  const name = (id: string) => {
    const user = client().users.get(id);
    return user?.displayName ?? user?.username ?? id;
  };

  /**
   * Every microphone we publish or hear right now
   */
  function describeMicrophones(room: Room): TrackDescriptor[] {
    const context = callContext();
    const tracks: TrackDescriptor[] = [];

    const local = room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    if (local) {
      tracks.push({
        ...context,
        key: `mic-${room.localParticipant.identity}`,
        direction: "sending",
        source: Track.Source.Microphone,
        participantId: room.localParticipant.identity,
        participantName: name(room.localParticipant.identity),
        getStats: () => local.getRTCStatsReport(),
        connectionQuality: () => room.localParticipant.connectionQuality,
      });
    }

    for (const participant of room.remoteParticipants.values()) {
      const track = participant.getTrackPublication(
        Track.Source.Microphone,
      )?.track;
      if (!track) continue;
      tracks.push({
        ...context,
        key: `mic-${participant.identity}`,
        direction: "receiving",
        source: Track.Source.Microphone,
        participantId: participant.identity,
        participantName: name(participant.identity),
        getStats: () => track.getRTCStatsReport(),
        connectionQuality: () => participant.connectionQuality,
      });
    }

    return tracks;
  }

  function describeTracks(room: Room): TrackDescriptor[] {
    const context = callContext();

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

    const overlay = !!state.settings.getValue("advanced:developer_overlay");
    const record = !!state.settings.getValue("advanced:developer_record");
    if (!overlay && !record) return;

    let busy = false;
    const interval = setInterval(async () => {
      // skip a tick rather than pile up if stats are slow
      if (busy) return;
      busy = true;
      try {
        await statsRecorder.tick(describeTracks(room), { record });
      } finally {
        busy = false;
      }
    }, STATS_INTERVAL_MS);

    onCleanup(() => {
      clearInterval(interval);
      statsRecorder.flush();
    });
  });

  createEffect(() => {
    const room = voice.room();
    if (!room || !state.settings.getValue("advanced:developer_voice")) return;

    const overlay = !!state.settings.getValue(
      "advanced:developer_voice_overlay",
    );
    const record = !!state.settings.getValue("advanced:developer_voice_record");
    if (!overlay && !record) return;

    let busy = false;
    const interval = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await callRecorder.tick(callContext(), describeMicrophones(room), {
          record,
        });
      } finally {
        busy = false;
      }
    }, STATS_INTERVAL_MS);

    onCleanup(() => {
      clearInterval(interval);
      callRecorder.flush();
    });
  });

  return null;
}
