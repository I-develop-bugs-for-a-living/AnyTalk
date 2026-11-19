import { createEffect, onCleanup } from "solid-js";

import { Track } from "livekit-client";

import { useClient } from "@revolt/client";
import { useState } from "@revolt/state";

import { useVoice } from "../state";
import {
  PREVIEW_FIRST_DELAY_MS,
  PREVIEW_INTERVAL_MS,
  encodeUnderLimit,
  previewSize,
} from "../streamPreview";

/** Longest time a frame capture may take, in milliseconds */
const CAPTURE_TIMEOUT_MS = 5000;

/**
 * Grab one frame of a video track as a small JPEG
 * @param track Screen share track
 * @returns The image, or undefined when no frame is available
 */
function captureFrame(track: MediaStreamTrack): Promise<Blob | undefined> {
  // a static share may never deliver a frame: give up after a while
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), CAPTURE_TIMEOUT_MS);
  });
  return Promise.race([grabFrame(track), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Draw the current frame of a video track to a JPEG
 * @param track Screen share track
 */
async function grabFrame(track: MediaStreamTrack): Promise<Blob | undefined> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track.clone()]);

  try {
    await video.play();
    // wait for a decoded frame, the size is unknown before
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        video.addEventListener(
          "loadeddata",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }

    const size = previewSize(video.videoWidth, video.videoHeight);
    if (!size) return undefined;

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, size.width, size.height);

    return await encodeUnderLimit(
      (quality) =>
        new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)),
    );
  } finally {
    video.pause();
    // stops the clone, not the shared track
    (video.srcObject as MediaStream | null)
      ?.getTracks()
      .forEach((clone) => clone.stop());
    video.srcObject = null;
  }
}

/**
 * Upload a thumbnail of our own screen share for people outside the call
 * (shown on hover in the sidebar), first shortly after the share starts and
 * then every few minutes. The preview is removed when the share ends, when we
 * leave the call or when the setting is turned off.
 *
 * Needs the preview endpoints of AnyTalk-Server. Failures are ignored.
 */
export function StreamPreviewUploader() {
  const voice = useVoice();
  const client = useClient();
  const state = useState();

  createEffect(() => {
    const room = voice.room();
    const channel = voice.channel();
    if (!room || !channel || !voice.screenshare()) return;
    if (!state.voice.streamPreview) return;

    const url = `${client().options.baseURL}/channels/${channel.id}/voice/preview`;
    /** Session header, read each time in case the session changed */
    const headers = () => {
      const [name, value] = client().authenticationHeader;
      return { [name]: value };
    };

    const abort = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Capture and upload one preview, then schedule the next */
    const run = async () => {
      try {
        const track = room.localParticipant.getTrackPublication(
          Track.Source.ScreenShare,
        )?.videoTrack?.mediaStreamTrack;
        const image = track && (await captureFrame(track));
        if (image && !stopped) {
          await fetch(url, {
            method: "PUT",
            headers: { ...headers(), "Content-Type": "image/jpeg" },
            body: image,
            signal: abort.signal,
          });
        }
      } catch (error) {
        console.debug("stream preview upload failed", error);
      }
      if (!stopped) timer = setTimeout(run, PREVIEW_INTERVAL_MS);
    };

    timer = setTimeout(run, PREVIEW_FIRST_DELAY_MS);

    onCleanup(() => {
      stopped = true;
      clearTimeout(timer);
      // an upload still on its way must not land after the delete
      abort.abort();
      // best effort, the server also drops it when the share ends
      fetch(url, {
        method: "DELETE",
        headers: headers(),
        keepalive: true,
      }).catch(() => undefined);
    });
  });

  return null;
}
