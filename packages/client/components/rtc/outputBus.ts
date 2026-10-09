/**
 * Call audio output for Safari (iPhone and macOS)
 *
 * LiveKit never calls setSinkId on Safari, and Safari has no
 * AudioContext.setSinkId. What does work is HTMLMediaElement.setSinkId, so in
 * bus mode all remote voices are mixed in one AudioContext into a
 * MediaStreamAudioDestinationNode, which one persistent hidden <audio>
 * element plays. Only that element's output device is ever switched.
 *
 * Safari needs a user gesture for every setSinkId call (and to start the
 * context and the element), so the entry points that must run inside a gesture
 * are documented as such.
 */

/** Interaction events a blocked action is retried on */
const RETRY_EVENTS = ["pointerdown", "touchend", "click"] as const;

type SinkElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

/** A remote track fed into the bus */
export type BusTrack = {
  /** Set the track's loudness, 1 is full volume and 0 is silent */
  setGain: (gain: number) => void;
  /** Stop playing the track */
  remove: () => void;
};

/**
 * Whether a user agent is a Safari-based browser: Safari itself, or any
 * browser on iOS (which all use WebKit)
 * @param userAgent User agent string
 * @param platform navigator.platform
 * @param touchPoints navigator.maxTouchPoints
 * @returns Whether it is Safari-based
 */
export function isSafariBasedAgent(
  userAgent: string,
  platform = "",
  touchPoints = 0,
): boolean {
  // iPadOS reports itself as a Mac, but has a touch screen
  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && touchPoints > 1);
  if (ios) return true;

  // other engines mention Safari too
  return (
    /Safari\//.test(userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android|Electron/i.test(userAgent)
  );
}

/**
 * Whether a user agent is an iPhone or iPad (any browser)
 * @param userAgent User agent string
 * @param platform navigator.platform
 * @param touchPoints navigator.maxTouchPoints
 * @returns Whether it is iOS
 */
export function isIOSAgent(
  userAgent: string,
  platform = "",
  touchPoints = 0,
): boolean {
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    // iPadOS reports itself as a Mac, but has a touch screen
    (platform === "MacIntel" && touchPoints > 1)
  );
}

/**
 * Whether this is iOS with output switching through the bus, where the
 * microphone can't be chosen and the call controls offer a simple
 * loudspeaker / phone call toggle instead of device lists
 * @returns Whether this is iOS in bus mode
 */
export function isIOSBusMode(): boolean {
  return (
    isBusMode() &&
    isIOSAgent(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints,
    )
  );
}

/**
 * Known names of the built-in earpiece. English and German are verified
 * ("Empfänger" on a German iPhone); "earpiece" is a guess.
 */
const EARPIECE_NAMES = /receiver|empf[aä]nger|earpiece/i;

/** Labels of Bluetooth-looking outputs (AirPods, headsets, cars) */
const BLUETOOTH_NAMES = /airpods|bluetooth|beats|buds|headset|headphones/i;

/**
 * Find the built-in earpiece among the outputs. iOS lists them as: the
 * default ("Standard - <route>"), the built-in speaker, the built-in
 * receiver, then Bluetooth devices.
 * @param outputs Output devices in the order the browser lists them
 * @returns The earpiece, or undefined when none is found
 */
export function findEarpiece<T extends { deviceId: string; label: string }>(
  outputs: T[],
): T | undefined {
  // the default entry only mirrors the current route, never the earpiece
  const real = outputs.filter((o) => o.deviceId !== "default");

  const byName = real.find((o) => EARPIECE_NAMES.test(o.label));
  if (byName) return byName;

  // Fallback by position: the entry after the built-in speaker. Only when
  // the first two entries aren't Bluetooth devices, so a headset is never
  // mistaken for the earpiece.
  if (
    real.length >= 2 &&
    !BLUETOOTH_NAMES.test(real[0].label) &&
    !BLUETOOTH_NAMES.test(real[1].label)
  ) {
    return real[1];
  }
  return undefined;
}

/**
 * Whether call audio has to go through the bus, which is when LiveKit can't
 * switch the output device itself (Safari) although the browser can
 * @returns Whether to use bus mode
 */
export function isBusMode(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype &&
    typeof AudioContext !== "undefined" &&
    isSafariBasedAgent(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints,
    )
  );
}

/**
 * Pick the sink ID to give setSinkId
 * @param deviceId Wanted device ID (undefined for the system default)
 * @returns Sink ID, an empty string is the system default. A device that is
 * gone is rejected by setSinkId, which then falls back to the default (see
 * applySink).
 */
export function pickSinkId(deviceId: string | undefined): string {
  return !deviceId || deviceId === "default" ? "" : deviceId;
}

let context: AudioContext | undefined;
let destination: MediaStreamAudioDestinationNode | undefined;
let element: SinkElement | undefined;

/** Output the element should play to, applied once it exists */
let wantedSink = "";
let releaseRetry: (() => void) | undefined;
/** Whether the bus was primed (in a gesture) and not torn down since */
let primed = false;

/**
 * Create the context, the destination and the hidden element if needed
 * @returns Whether the bus could be created
 */
function ensure(): boolean {
  if (context && context.state !== "closed" && element && destination) {
    return true;
  }

  // a leftover element of a closed context
  element?.remove();
  element = undefined;

  try {
    context = new AudioContext();
    destination = context.createMediaStreamDestination();

    const audio: SinkElement = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("aria-hidden", "true");
    // not display:none, so the browser never treats it as unused
    audio.style.cssText =
      "position:fixed;width:0;height:0;opacity:0;pointer-events:none";
    audio.srcObject = destination.stream;
    document.body.appendChild(audio);
    element = audio;
    applySink();
  } catch (err) {
    console.error("[rtc] could not set up the audio output bus", err);
    teardown();
    return false;
  }

  return true;
}

/** Actions waiting for the next interaction */
const pending = new Set<() => void>();

/**
 * Run an action on the next interaction. Several actions can wait at the
 * same time, they all run in that gesture.
 * @param action Action to run, from within that gesture
 */
function retryOnInteraction(action: () => void) {
  pending.add(action);
  if (releaseRetry) return;

  const release = () => {
    RETRY_EVENTS.forEach((e) =>
      window.removeEventListener(e, onInteraction, true),
    );
    if (releaseRetry === release) releaseRetry = undefined;
  };
  const onInteraction = () => {
    release();
    const actions = [...pending];
    pending.clear();
    actions.forEach((run) => run());
  };

  RETRY_EVENTS.forEach((e) => window.addEventListener(e, onInteraction, true));
  releaseRetry = release;
}

/**
 * Start the context and the element, which needs a gesture. If the browser
 * refuses, it is tried again on the next interaction.
 */
function start() {
  const ctx = context;
  const el = element;
  if (!ctx || !el) return;

  let blocked = false;
  const block = () => {
    if (blocked) return;
    blocked = true;
    retryOnInteraction(start);
  };

  if (ctx.state !== "running") {
    ctx.resume().catch(block);
    // resume() can stay pending, check again shortly
    setTimeout(() => {
      if (context === ctx && ctx.state !== "running") block();
    }, 500);
  }
  if (el.paused) el.play().catch(block);
}

/**
 * Apply the wanted output to the element
 * @param retried Whether this is already the retry
 */
function applySink(retried = false) {
  const el = element;
  if (!el?.setSinkId) return;

  const sink = wantedSink;
  el.setSinkId(sink).catch((err: DOMException) => {
    if (element !== el) return;

    if (err?.name === "NotAllowedError") {
      if (!retried) {
        // needs a gesture, try again on the next one
        retryOnInteraction(() => applySink(true));
      } else {
        console.error("[rtc] the audio output needs a gesture", err);
      }
    } else if (sink !== "") {
      // e.g. the device is gone: use the default instead
      wantedSink = "";
      applySink(true);
    } else {
      console.error("[rtc] could not set the audio output", err);
    }
  });
}

/**
 * Get the bus ready. Must be called from within a user gesture (e.g. the tap
 * that joins the call): starts the context and the element, and applies the
 * output device.
 * @param deviceId Wanted output device (undefined for the system default)
 */
export function prime(deviceId?: string) {
  primed = true;
  wantedSink = pickSinkId(deviceId);

  // a new element gets the wanted output in ensure() already
  const existed = !!element;
  if (!ensure()) return;

  // setSinkId has to be started within the gesture, so don't wait for anything
  if (existed) applySink();
  start();
}

/**
 * Play to another output device. Must be called from within a user gesture,
 * the setSinkId call is started synchronously.
 * @param deviceId Output device (undefined or "default" for the system default)
 */
export function setOutput(deviceId?: string) {
  prime(deviceId);
}

/**
 * Play a remote track through the bus
 * @param track Remote audio track
 * @returns Controls for the track
 */
export function addTrack(track: MediaStreamTrack): BusTrack {
  // a bus built outside a gesture couldn't be switched to the chosen output
  if (!primed || !ensure() || !context || !destination) {
    return { setGain: () => {}, remove: () => {} };
  }

  const ctx = context;
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain).connect(destination);

  // the context may still be waiting for a gesture
  start();

  return {
    setGain: (value) => {
      gain.gain.setTargetAtTime(Math.max(0, value), ctx.currentTime, 0.015);
    },
    remove: () => {
      source.disconnect();
      gain.disconnect();
    },
  };
}

/**
 * Release the bus when the call ends
 */
export function teardown() {
  primed = false;
  pending.clear();
  releaseRetry?.();
  releaseRetry = undefined;

  if (element) {
    element.pause();
    element.srcObject = null;
    element.remove();
  }
  context?.close().catch(() => {});

  element = undefined;
  destination = undefined;
  context = undefined;
}
