async function createRNNWasmModule(moduleArg={}){var Module=moduleArg;var ENVIRONMENT_IS_AUDIO_WORKLET=!!globalThis.AudioWorkletGlobalScope;var programArgs=[];var thisProgram="./this.program";var scriptDirectory="";function locateFile(path){if(Module["locateFile"]){return Module["locateFile"](path,scriptDirectory)}return scriptDirectory+path}var readAsync,readBinary;{}var out=console.log.bind(console);var err=console.error.bind(console);var wasmBinary;var ABORT=false;class EmscriptenEH{}class EmscriptenSjLj extends EmscriptenEH{}var runtimeInitialized=false;function getMemoryBuffer(){return wasmMemory.toResizableBuffer()}function updateMemoryViews(){if(HEAP8?.buffer?.resizable)return;var b=getMemoryBuffer();HEAP8=new Int8Array(b);HEAPU8=new Uint8Array(b);Module["HEAPF32"]=HEAPF32=new Float32Array(b)}function preRun(){var preRun=Module["preRun"];if(preRun){if(typeof preRun=="function")preRun=[preRun];onPreRuns.push(...preRun)}callRuntimeCallbacks(onPreRuns)}function initRuntime(){runtimeInitialized=true;wasmExports["c"]()}function postRun(){var postRun=Module["postRun"];if(postRun){if(typeof postRun=="function")postRun=[postRun];onPostRuns.push(...postRun)}callRuntimeCallbacks(onPostRuns)}function abort(what){Module["onAbort"]?.(what);what=`Aborted(${what})`;err(what);ABORT=true;what+=". Build with -sASSERTIONS for more info.";var e=new WebAssembly.RuntimeError(what);throw e}var wasmBinaryFile;function findWasmBinary(){return locateFile("RNNoiseWorklet.wasm")}function getBinarySync(file){if(readBinary){return readBinary(file)}throw"both async and sync fetching of the wasm failed"}async function getWasmBinary(binaryFile){if(!wasmBinary){try{var response=await readAsync(binaryFile);return new Uint8Array(response)}catch{}}return getBinarySync(binaryFile)}async function instantiateArrayBuffer(binaryFile,imports){try{var binary=await getWasmBinary(binaryFile);var instance=await WebAssembly.instantiate(binary,imports);return instance}catch(reason){err(`failed to asynchronously prepare wasm: ${reason}`);abort(reason)}}async function instantiateAsync(binary,binaryFile,imports){if(!binary){try{var response=fetch(binaryFile,{credentials:"same-origin"});var instantiationResult=await WebAssembly.instantiateStreaming(response,imports);return instantiationResult}catch(reason){err(`wasm streaming compile failed: ${reason}`);err("falling back to ArrayBuffer instantiation")}}return instantiateArrayBuffer(binaryFile,imports)}function getWasmImports(){var imports={a:wasmImports};return imports}async function createWasm(){function receiveInstance(instance){wasmExports=instance.exports;assignWasmExports(wasmExports);updateMemoryViews();return wasmExports}function receiveInstantiationResult(result){return receiveInstance(result["instance"])}var info=getWasmImports();var instantiateWasm=Module["instantiateWasm"];if(instantiateWasm){return new Promise(resolve=>{instantiateWasm(info,inst=>resolve(receiveInstance(inst)))})}wasmBinaryFile??=findWasmBinary();var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);var exports=receiveInstantiationResult(result);return exports}class ExitStatus{name="ExitStatus";constructor(status){this.message=`Program terminated with exit(${status})`;this.status=status}}var HEAP8;var callRuntimeCallbacks=callbacks=>{while(callbacks.length>0){callbacks.shift()(Module)}};var onPostRuns=[];var onPreRuns=[];var noExitRuntime=true;var getHeapMax=()=>2147483648;var alignMemory=(size,alignment)=>Math.ceil(size/alignment)*alignment;var growMemory=size=>{var oldHeapSize=wasmMemory.buffer.byteLength;var pages=(size-oldHeapSize+65535)/65536|0;try{wasmMemory.grow(pages);return 1}catch(e){}};var HEAPU8;var _emscripten_resize_heap=requestedSize=>{var oldSize=HEAPU8.length;requestedSize>>>=0;var maxHeapSize=getHeapMax();if(requestedSize>maxHeapSize){return false}for(var cutDown=1;cutDown<=4;cutDown*=2){var overGrownHeapSize=oldSize*(1+.2/cutDown);overGrownHeapSize=Math.min(overGrownHeapSize,requestedSize+100663296);var newSize=Math.min(maxHeapSize,alignMemory(Math.max(requestedSize,overGrownHeapSize),65536));var replacement=growMemory(newSize);if(replacement){return true}}return false};var HEAPF32;{if(Module["noExitRuntime"])noExitRuntime=Module["noExitRuntime"];if(Module["print"])out=Module["print"];if(Module["printErr"])err=Module["printErr"];if(Module["arguments"])programArgs=Module["arguments"];if(Module["thisProgram"])thisProgram=Module["thisProgram"];var preInit=Module["preInit"];if(preInit){if(typeof preInit=="function")Module["preInit"]=preInit=[preInit];while(preInit.length>0){preInit.shift()()}}}var _rnnoise_create,_rnnoise_destroy,_rnnoise_process_frame,_free,_malloc,memory,__indirect_function_table,wasmMemory;function assignWasmExports(wasmExports){_rnnoise_create=Module["_rnnoise_create"]=wasmExports["d"];_rnnoise_destroy=Module["_rnnoise_destroy"]=wasmExports["e"];_rnnoise_process_frame=Module["_rnnoise_process_frame"]=wasmExports["f"];_free=Module["_free"]=wasmExports["g"];_malloc=Module["_malloc"]=wasmExports["h"];memory=wasmMemory=wasmExports["b"];__indirect_function_table=wasmExports["__indirect_function_table"]}var wasmImports={a:_emscripten_resize_heap};async function run(){preRun();var setStatus=Module["setStatus"];if(setStatus){setStatus("Running...");await new Promise(resolve=>setTimeout(resolve,1));setTimeout(setStatus,1,"")}if(ABORT)return;initRuntime();Module["onRuntimeInitialized"]?.();postRun()}var wasmExports;wasmExports=await createWasm();await run();
;return Module}if(typeof exports==="object"&&typeof module==="object"){module.exports=createRNNWasmModule;module.exports.default=createRNNWasmModule}else if(typeof define==="function"&&define["amd"])define([],()=>createRNNWasmModule);
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
