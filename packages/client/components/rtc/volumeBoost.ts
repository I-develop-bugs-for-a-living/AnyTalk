import {
  Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import { RemoteTrackPublication, TrackEvent } from "livekit-client";

/**
 * Playback above 100% for remote audio tracks
 *
 * An <audio> element can't play louder than volume 1, so boosted tracks are
 * routed through a gain node instead. All boosted tracks share one
 * AudioContext which is only kept while something is boosted.
 *
 * Whenever boosting can't work (the context won't start, or it can't play
 * to the chosen output device) the track falls back to normal playback
 * capped at 100%, it never goes silent.
 */

type AudioContextWithSink = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

/**
 * iOS Safari ignores media element volume, we can't silence the element
 * there so boosting would play tracks twice
 */
const canSetElementVolume = (() => {
  const el = document.createElement("audio");
  el.volume = 0.5;
  return el.volume === 0.5;
})();

let context: AudioContextWithSink | undefined;
let users = 0;

const [running, setRunning] = createSignal(false);
const [outputDevice, setOutputDevice] = createSignal("");
const [sinkReady, setSinkReady] = createSignal(true);

/**
 * Normalise an output device ID, "default" doesn't work for AudioContext
 * @param deviceId Device ID
 * @returns Device ID or empty string for the system default
 */
function normaliseDevice(deviceId?: string) {
  return !deviceId || deviceId === "default" ? "" : deviceId;
}

/**
 * Try to start the context, waiting for the next interaction if the browser
 * won't let us start it yet
 */
function resume() {
  const ctx = context;
  if (!ctx || ctx.state !== "suspended") return;

  ctx.resume().catch(() => {});

  const onInteraction = () => {
    window.removeEventListener("pointerdown", onInteraction, true);
    window.removeEventListener("keydown", onInteraction, true);
    if (context === ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  };

  window.addEventListener("pointerdown", onInteraction, true);
  window.addEventListener("keydown", onInteraction, true);
}

/**
 * Play the shared context to the current output device
 */
function applySink() {
  const ctx = context;
  if (!ctx) return;

  const deviceId = outputDevice();
  if (!ctx.setSinkId) {
    // e.g. Firefox: only boost when playing to the default device
    setSinkReady(deviceId === "");
    return;
  }

  setSinkReady(false);
  ctx
    .setSinkId(deviceId)
    .then(() => context === ctx && setSinkReady(true))
    .catch((err) => {
      console.error("[rtc] could not set boost output device", err);
      // fall back to normal playback on the chosen device
      if (context === ctx) setSinkReady(deviceId === "");
    });
}

/**
 * Take a reference to the shared context
 * @returns Context
 */
function acquire() {
  users++;

  if (!context || context.state === "closed") {
    const ctx: AudioContextWithSink = new AudioContext();
    context = ctx;

    ctx.addEventListener("statechange", () => {
      if (context === ctx) setRunning(ctx.state === "running");
    });

    setRunning(ctx.state === "running");
    applySink();
    resume();
  }

  return context;
}

/**
 * Drop a reference to the shared context, closing it once unused
 */
function release() {
  users--;

  if (users === 0 && context) {
    context.close().catch(() => {});
    context = undefined;
    setRunning(false);
    setSinkReady(true);
  }
}

/**
 * Set the output device boosted audio plays to
 * @param deviceId Device ID (undefined or "default" for the system default)
 */
export function setBoostOutputDevice(deviceId?: string) {
  const normalised = normaliseDevice(deviceId);
  if (normalised === outputDevice()) return;

  setOutputDevice(normalised);
  applySink();
}

/**
 * Boost a remote track's playback while its volume is above 1
 * @param publication Track publication
 * @param volume Target volume
 * @returns Whether the boost is playing the track, if so its media element
 * should be silenced (volume 0), otherwise it should play at min(volume, 1)
 */
export function createVolumeBoost(
  publication: Accessor<RemoteTrackPublication>,
  volume: Accessor<number>,
): Accessor<boolean> {
  const [mediaTrack, setMediaTrack] = createSignal<MediaStreamTrack>();
  const [gainNode, setGainNode] = createSignal<GainNode>();

  // follow the track through resubscriptions
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

  const boosting = createMemo(() => canSetElementVolume && volume() > 1);

  createEffect(() => {
    const track = mediaTrack();
    if (!track || !boosting()) return;

    const ctx = acquire();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = ctx.createGain();

    gain.gain.value = 0;
    source.connect(gain).connect(ctx.destination);
    setGainNode(gain);

    onCleanup(() => {
      setGainNode(undefined);
      source.disconnect();
      gain.disconnect();
      release();
    });
  });

  const active = createMemo(() => !!gainNode() && running() && sinkReady());

  // while inactive the element plays instead, so keep the boost silent to
  // never hear the track twice (e.g. on the wrong output device)
  createEffect(() => {
    const gain = gainNode();
    if (gain) gain.gain.value = active() ? volume() : 0;
  });

  return active;
}
