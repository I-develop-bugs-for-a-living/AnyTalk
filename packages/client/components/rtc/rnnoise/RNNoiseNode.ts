import workletUrl from "./wasm/RNNoiseWorklet.js?url";
import wasmUrl from "./wasm/rnnoise.wasm?url";

let wasm: ArrayBuffer | undefined;
const loadedContexts = new WeakSet<BaseAudioContext>();

/**
 * Noise suppression with RNNoise, which also fades out audio away from speech
 *
 * The worklet is built from worklet.js by build.sh.
 */
export class RNNoiseNode extends AudioWorkletNode {
  /**
   * Load the worklet into the context and download the model, must be awaited
   * before creating a node
   */
  static async loadModule(context: BaseAudioContext) {
    if (loadedContexts.has(context)) return;
    const [, binary] = await Promise.all([
      context.audioWorklet.addModule(workletUrl),
      wasm ??
        fetch(wasmUrl).then((res) => {
          if (!res.ok) throw new Error(`rnnoise.wasm: HTTP ${res.status}`);
          return res.arrayBuffer();
        }),
    ]);
    wasm = binary;
    loadedContexts.add(context);
  }

  /**
   * Whether loadModule has finished for this context
   */
  static isLoaded(context: BaseAudioContext) {
    return loadedContexts.has(context);
  }

  /**
   * @param speechGate Whether to mute audio away from speech
   */
  constructor(context: BaseAudioContext, speechGate: boolean) {
    if (!wasm || !loadedContexts.has(context)) {
      throw new Error("call RNNoiseNode.loadModule first");
    }

    super(context, "RNNoiseWorklet", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { wasm, gate: { enabled: speechGate } },
    });
  }

  /**
   * Turn muting audio away from speech on or off
   */
  setGate(enabled: boolean) {
    this.port.postMessage({ message: "SET_GATE", gate: { enabled } });
  }

  /**
   * Free the RNNoise state, the node can't be used afterwards
   */
  destroy() {
    this.disconnect();
    this.port.postMessage({ message: "DESTROY" });
  }
}
