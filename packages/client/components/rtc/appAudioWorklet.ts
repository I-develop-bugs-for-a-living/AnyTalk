/*
 * AudioWorklet that plays per-process app audio. It runs in the audio
 * thread: chunks arrive on its port as interleaved stereo float32 and are
 * played through a small ring buffer (see appAudioRing.ts).
 */
import { APP_AUDIO_RATE, AppAudioRing } from "./appAudioRing";

// The worklet scope has these globals, the DOM typings don't
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

/** Frames held at most: 200 ms. */
const CAPACITY = APP_AUDIO_RATE / 5;
/** Frames queued before playing: 60 ms, enough to bridge uneven delivery. */
const PREFILL = (APP_AUDIO_RATE * 6) / 100;

/** Plays the chunks posted to its port as stereo output. */
class AppAudioProcessor extends AudioWorkletProcessor {
  /** Queue between the port and the output. */
  readonly #ring = new AppAudioRing(CAPACITY, PREFILL);

  /** Starts listening for chunks. */
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.#ring.write(event.data);
    };
  }

  /**
   * Fill one output block.
   *
   * @param _inputs Unused
   * @param outputs The output buses
   * @returns true, the node stays alive until it is disconnected
   */
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    if (channels && channels.length >= 2) {
      this.#ring.read(channels[0], channels[1]);
    }
    return true;
  }
}

registerProcessor("app-audio-player", AppAudioProcessor);
