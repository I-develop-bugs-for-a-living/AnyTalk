import { APP_AUDIO_CHANNELS, APP_AUDIO_RATE } from "./appAudioRing";
import workletUrl from "./appAudioWorklet.ts?worker&url";

/** How long the audio context gets to start running before a warning. */
const CONTEXT_CHECK_MS = 2000;

/** Most chunks (10 ms each) kept while the audio graph is being built. */
const MAX_EARLY_CHUNKS = 20;

/**
 * Turn the sound of the shared window's process into an audio track. The
 * desktop app captures it natively (Windows only) and streams it here, an
 * AudioWorklet plays it into a MediaStream. The capture must have been
 * started by the desktop app for this share, see `attachAppAudio`.
 *
 * The audio graph is only built once the desktop app confirmed that this
 * share has such audio, so screens and other shares cost nothing.
 *
 * Stopping the returned track (or the video track ending, or the capture
 * ending by itself) stops the native capture and closes the audio context.
 *
 * @param video The share's video track, its end ends the audio too
 * @returns The track, or undefined when this share has no app audio
 */
export async function createAppAudioTrack(
  video: MediaStreamTrack | undefined,
): Promise<MediaStreamTrack | undefined> {
  const native = window.native;
  if (!native?.attachAppAudio || !native.stopAppAudio) return undefined;
  if (typeof AudioWorkletNode === "undefined") return undefined;

  /** Where chunks go once the graph exists, until then they are queued */
  let sink: ((chunk: Float32Array) => void) | undefined;
  const early: Float32Array[] = [];
  /** Message of a capture that ended before the graph was ready */
  let endedEarly: string | undefined;
  /** Called when the capture ends by itself, set once the track exists */
  let onEnded: ((message: string) => void) | undefined;

  let id: number | null;
  try {
    id = await native.attachAppAudio(
      (chunk) => {
        if (sink) return sink(chunk);
        early.push(chunk);
        if (early.length > MAX_EARLY_CHUNKS) early.shift();
      },
      (message) => {
        if (onEnded) onEnded(message);
        else endedEarly = message;
      },
    );
  } catch (error) {
    console.warn("App audio unavailable:", error);
    return undefined;
  }
  if (id === null) return undefined;
  const captureId = id;

  let context: AudioContext | undefined;
  try {
    context = new AudioContext({
      sampleRate: APP_AUDIO_RATE,
      latencyHint: "interactive",
    });
    const ctx = context;
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, "app-audio-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [APP_AUDIO_CHANNELS],
    });
    const destination = ctx.createMediaStreamDestination();
    node.connect(destination);
    // not awaited: a context that stays suspended must not hold up the share
    void ctx.resume().catch(() => {});
    // a context that stays suspended plays nothing: leave a trace to find it
    setTimeout(() => {
      if (!closed && ctx.state !== "running")
        console.warn("App audio context is not running:", ctx.state);
    }, CONTEXT_CHECK_MS);

    const track = destination.stream.getAudioTracks()[0];
    const stopTrack = track.stop.bind(track);
    let closed = false;

    /** Free everything of this capture, once */
    const cleanup = () => {
      if (closed) return;
      closed = true;
      video?.removeEventListener("ended", onVideoEnded);
      sink = undefined;
      native.stopAppAudio?.(captureId).catch(() => {});
      node.port.onmessage = null;
      node.disconnect();
      ctx.close().catch(() => {});
    };
    const onVideoEnded = () => track.stop();
    video?.addEventListener("ended", onVideoEnded, { once: true });

    // LiveKit stops the track when the share ends or is swapped
    track.stop = () => {
      cleanup();
      stopTrack();
    };
    onEnded = (message) => {
      // e.g. the app was closed: the video keeps going without sound
      console.warn("App audio ended:", message);
      cleanup();
      stopTrack();
      track.dispatchEvent(new Event("ended"));
    };

    if (endedEarly !== undefined) {
      onEnded(endedEarly);
      return undefined;
    }
    for (const chunk of early) node.port.postMessage(chunk);
    early.length = 0;
    sink = (chunk) => node.port.postMessage(chunk);
    return track;
  } catch (error) {
    // the capture is running, so end it now instead of at its timeout
    console.warn("App audio unavailable:", error);
    context?.close().catch(() => {});
    native.stopAppAudio(captureId).catch(() => {});
    return undefined;
  }
}
