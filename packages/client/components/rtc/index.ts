import { screenCaptureLimit } from "./screenCapture";
import { getVirtmic } from "./virtualMic";

export { useVoice, VoiceContext } from "./state";

export { InRoom } from "./components/InRoom";
export { RoomAudioManager } from "./components/RoomAudioManager";
export { findEarpiece, isIOSBusMode } from "./outputBus";
export { useFastIsSpeaking } from "./speaking";
export { stoatSinkName } from "./virtualMic";

// missing outside secure contexts (e.g. a dev server opened over http)
const mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
const originalMediaCall = mediaDevices?.getDisplayMedia;

/**
 * Whether this browser can share its screen, iOS and Android browsers can't
 */
export const screenShareSupported = typeof originalMediaCall === "function";

if (mediaDevices && originalMediaCall)
  mediaDevices.getDisplayMedia = async function (opts) {
    // Open the capture at the largest quality the server allows, the chosen
    // quality is applied by scaling it down afterwards (see screenCapture)
    if (opts && opts.video && typeof opts.video === "object") {
      const limit = screenCaptureLimit();
      opts.video = {
        ...opts.video,
        frameRate: { ideal: limit.frameRate, max: limit.frameRate },
        width: { ideal: limit.width, max: limit.width },
        height: { ideal: limit.height, max: limit.height },
      };
    }

    const stream: MediaStream = await originalMediaCall.call(this, opts);

    if (opts && opts.audio && window.native?.isWayland?.()) {
      const id = await getVirtmic();

      console.debug("Virt mic acquired:", id);

      if (id) {
        const audio = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: {
              exact: id,
            },
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 2,
            sampleRate: 48000,
            sampleSize: 16,
          },
        });

        stream.getAudioTracks().forEach((t) => stream.removeTrack(t));
        stream.addTrack(audio.getAudioTracks()[0]);
      }
    }

    return stream;
  };
