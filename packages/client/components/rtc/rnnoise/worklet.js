/* global AudioWorkletProcessor, registerProcessor, sampleRate, createRNNWasmModule, WebAssembly */

/**
 * RNNoise audio worklet with a voice activity gate.
 *
 * build.sh appends this file to the Emscripten glue (which defines
 * createRNNWasmModule), so the worklet is a single file without imports.
 *
 * RNNoise removes steady noise well but can let short sounds (e.g. someone
 * hitting their desk) through. It also returns how likely each 10 ms frame
 * is speech, so frames that are not near any speech are faded out.
 */

// RNNoise works on 10 ms frames at 48 kHz with samples in 16-bit range
const FRAME_SIZE = 480;
const RNNOISE_SAMPLE_RATE = 48000;
const SCALE = 32768;

const DEFAULT_GATE = {
  // whether audio away from speech is faded out at all
  enabled: true,
  // speech probability needed to open the gate
  threshold: 0.6,
  // frames looked ahead, so the start of a word isn't cut off (adds latency)
  lookahead: 1,
  // frames the gate stays open after speech, bridges pauses between words
  hold: 30,
  // gain while closed
  floor: 0,
  // fade in and fade out time constants in seconds
  attack: 0.003,
  release: 0.08,
};

/**
 * Streaming linear interpolation resampler for a mono signal
 */
class Resampler {
  /**
   * @param {number} from Input sample rate
   * @param {number} to Output sample rate
   */
  constructor(from, to) {
    this.passthrough = from === to;
    // input samples advanced per output sample
    this.step = from / to;
    // position of the next output sample, relative to the previous input sample
    this.position = 1;
    this.previous = 0;
  }

  /**
   * @param {Float32Array} input
   * @param {(sample: number) => void} emit
   */
  process(input, emit) {
    if (this.passthrough) {
      for (let i = 0; i < input.length; i++) emit(input[i]);
      return;
    }

    // position 0 is this.previous, position 1 is input[0], ...
    let position = this.position;
    while (position < input.length) {
      const index = Math.floor(position);
      const a = index === 0 ? this.previous : input[index - 1];
      emit(a + (input[index] - a) * (position - index));
      position += this.step;
    }

    this.position = position - input.length;
    this.previous = input[input.length - 1];
  }
}

/**
 * Single producer, single consumer queue of samples
 */
class SampleQueue {
  constructor(capacity) {
    this.buffer = new Float32Array(capacity);
    this.read = 0;
    this.size = 0;
  }

  push(sample) {
    if (this.size === this.buffer.length) {
      // drop the oldest sample rather than grow
      this.read = (this.read + 1) % this.buffer.length;
      this.size--;
    }
    this.buffer[(this.read + this.size) % this.buffer.length] = sample;
    this.size++;
  }

  shift() {
    const sample = this.buffer[this.read];
    this.read = (this.read + 1) % this.buffer.length;
    this.size--;
    return sample;
  }
}

class RNNoiseWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const { wasm, gate } = options.processorOptions ?? {};
    if (!wasm) {
      throw new Error("RNNoiseWorklet needs the rnnoise wasm binary");
    }

    this.gate = { ...DEFAULT_GATE, ...gate };
    this.destroyed = false;

    this.inputResampler = new Resampler(sampleRate, RNNOISE_SAMPLE_RATE);
    this.outputResampler = new Resampler(RNNOISE_SAMPLE_RATE, sampleRate);
    this.output = new SampleQueue(sampleRate);

    // samples of the frame being collected
    this.frame = new Float32Array(FRAME_SIZE);
    this.frameIndex = 0;

    // denoised frames waiting for the lookahead, with their speech probability
    this.pending = [];
    this.gateHold = 0;
    this.gain = this.gate.floor;

    // bound once instead of creating closures per render quantum
    this.collectInput = this.collectInput.bind(this);
    this.emitOutput = (sample) => this.output.push(sample);

    this.port.onmessage = ({ data }) => {
      if (data.message === "SET_GATE") {
        this.gate = { ...this.gate, ...data.gate };
      } else if (data.message === "DESTROY") {
        this.destroy();
      }
    };

    createRNNWasmModule({
      instantiateWasm(imports, done) {
        const instance = new WebAssembly.Instance(
          new WebAssembly.Module(wasm),
          imports,
        );
        done(instance);
        return instance.exports;
      },
    }).then((module) => {
      if (this.destroyed) return;
      this.module = module;
      // NULL selects the model built into the wasm
      this.state = module._rnnoise_create(0);
      this.framePtr = module._malloc(FRAME_SIZE * 4);
    });
  }

  collectInput(sample) {
    this.frame[this.frameIndex++] = sample * SCALE;
    if (this.frameIndex === FRAME_SIZE) {
      this.frameIndex = 0;
      this.denoiseFrame();
    }
  }

  denoiseFrame() {
    const heap = this.module.HEAPF32;
    const offset = this.framePtr >> 2;
    heap.set(this.frame, offset);
    const vad = this.module._rnnoise_process_frame(
      this.state,
      this.framePtr,
      this.framePtr,
    );
    const samples = heap.slice(offset, offset + FRAME_SIZE);

    this.pending.push({ samples, vad });
    // no lookahead (and its latency) while the gate is off
    const lookahead = this.gate.enabled ? this.gate.lookahead : 0;
    while (this.pending.length > lookahead) {
      this.gateFrame(this.pending.shift());
    }
  }

  /**
   * Fade the oldest frame in or out based on speech in it or the frames after it
   */
  gateFrame({ samples, vad }) {
    const gate = this.gate;

    let speech = vad >= gate.threshold;
    for (let i = 0; !speech && i < this.pending.length; i++) {
      speech = this.pending[i].vad >= gate.threshold;
    }

    if (speech) {
      this.gateHold = gate.hold;
    } else if (this.gateHold > 0) {
      this.gateHold--;
    }

    const open = !gate.enabled || speech || this.gateHold > 0;
    const target = open ? 1 : gate.floor;
    const coefficient =
      1 -
      Math.exp(
        -1 / ((open ? gate.attack : gate.release) * RNNOISE_SAMPLE_RATE),
      );

    let gain = this.gain;
    for (let i = 0; i < FRAME_SIZE; i++) {
      gain += (target - gain) * coefficient;
      samples[i] = (samples[i] * gain) / SCALE;
    }
    this.gain = gain;

    this.outputResampler.process(samples, this.emitOutput);
  }

  process(inputs, outputs) {
    if (this.destroyed) return false;

    const input = inputs[0]?.[0];
    const output = outputs[0];

    // pass silence until the wasm module is ready
    if (!this.module || !input) return true;

    this.inputResampler.process(input, this.collectInput);

    // wait until a full render quantum is available
    const length = output[0].length;
    if (this.output.size < length) return true;

    const channel = output[0];
    for (let i = 0; i < length; i++) {
      channel[i] = this.output.shift();
    }
    for (let c = 1; c < output.length; c++) {
      output[c].set(channel);
    }

    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.module) {
      this.module._rnnoise_destroy(this.state);
      this.module._free(this.framePtr);
      this.module = undefined;
    }
    this.pending = [];
    this.port.close();
  }
}

registerProcessor("RNNoiseWorklet", RNNoiseWorklet);
