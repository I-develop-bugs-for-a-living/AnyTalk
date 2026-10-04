import { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { createEffect, createRoot, on } from "solid-js";

import { Voice } from "@revolt/state/stores/Voice";

import { RNNoiseNode } from "./rnnoise/RNNoiseNode";

/**
 * Q of two cascaded biquads forming a 4th order Butterworth filter
 */
const HIGHPASS_Q = [0.5412, 1.3066];

export class VoiceProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = "stoat-voice-processor";
  processedTrack?: MediaStreamTrack;

  private audioContext?: AudioContext;
  private settings: Voice;

  private noiseSuppressionNode?: RNNoiseNode;
  private sourceNode?: MediaStreamAudioSourceNode;
  private highpassNodes: BiquadFilterNode[] = [];
  private compressorNode?: DynamicsCompressorNode;
  private gainNode?: GainNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  private disposeSolidjsContext: () => void = () => {};
  private onBlockedChange?: (blocked: boolean) => void;

  /**
   * @param voiceSettings Voice settings
   * @param onBlockedChange Called when the audio context stops or starts
   * running, while stopped (e.g. suspended or interrupted on iOS) we send
   * silence until it's resumed from a user gesture
   */
  constructor(
    voiceSettings: Voice,
    onBlockedChange?: (blocked: boolean) => void,
  ) {
    this.settings = voiceSettings;
    this.onBlockedChange = onBlockedChange;

    // Create a solid root to track changes to the settings
    createRoot((dispose) => {
      // On input volume setting change, set the gain
      createEffect(() => {
        this.setGain(this.getSettings().inputVolume);
      });

      // On noise suppression setting change, toggle noise suppression
      createEffect(
        on(
          () => this.getSettings().noiseSupression,
          (newNoiseSuppresion, oldNoiseSuppression) => {
            // Only rebuild if noise supression has changed from enhanced to something else or vice versa
            if (
              oldNoiseSuppression &&
              oldNoiseSuppression !== newNoiseSuppresion &&
              (newNoiseSuppresion === "enhanced" ||
                oldNoiseSuppression === "enhanced")
            ) {
              this.rebuild();
            }
          },
        ),
      );

      // On high-pass filter setting change, retune or add/remove the filter
      createEffect(
        on(
          () => this.getSettings().highpassFrequency,
          (frequency, oldFrequency) => {
            if (oldFrequency === undefined) return;
            if (frequency > 0 && this.highpassNodes.length) {
              this.highpassNodes.forEach(
                (node) => (node.frequency.value = frequency),
              );
            } else if (frequency > 0 !== oldFrequency > 0) {
              this.rebuild();
            }
          },
        ),
      );

      // On speech gate setting change, tell RNNoise
      createEffect(() => {
        this.noiseSuppressionNode?.setGate(this.getSettings().speechGate);
      });

      // This is needed to destroy the solid context on unload
      this.disposeSolidjsContext = dispose;
    });
  }

  private getSettings(): Voice {
    return this.settings;
  }

  private setGain(newGain: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = newGain;
    }
  }

  private updateBlocked = () => {
    this.onBlockedChange?.(
      !!this.audioContext && this.audioContext.state !== "running",
    );
  };

  /**
   * Resume the audio context, must be called from a user gesture
   */
  resume() {
    if (this.audioContext && this.audioContext.state !== "running") {
      this.audioContext.resume().catch(() => {});
    }
  }

  private async rebuild() {
    const context = this.audioContext;
    if (!context) return;
    await this.loadNoiseSuppression(context);
    // skip if the processor was rebuilt or destroyed in the meantime
    if (context === this.audioContext && this.sourceNode) {
      this.connectProcessing(context);
    }
  }

  /**
   * Download RNNoise if it's needed, only done once it's turned on
   */
  private async loadNoiseSuppression(context: AudioContext) {
    if (this.settings.noiseSupression !== "enhanced") return;
    try {
      await RNNoiseNode.loadModule(context);
    } catch (err) {
      console.error("[rtc] could not load RNNoise", err);
    }
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    return this.build(opts);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    return this.build(opts);
  }

  async destroy(): Promise<void> {
    // Destroy the solid context on processor destruction
    this.disposeSolidjsContext();
    this.audioContext?.removeEventListener("statechange", this.updateBlocked);
    this.audioContext = undefined;
    this.onBlockedChange?.(false);
    return this.teardown();
  }

  private disconnectProcessing() {
    this.sourceNode?.disconnect();
    this.highpassNodes.forEach((node) => node.disconnect());
    this.noiseSuppressionNode?.destroy();
    this.compressorNode?.disconnect();
    this.highpassNodes = [];
    this.noiseSuppressionNode = undefined;
    this.compressorNode = undefined;
  }

  /**
   * Connect source -> high-pass filter -> RNNoise -> compressor -> gain,
   * leaving out what is turned off
   */
  private connectProcessing(context: AudioContext) {
    this.disconnectProcessing();

    let last: AudioNode = this.sourceNode!;

    const frequency = this.settings.highpassFrequency;
    if (frequency > 0) {
      this.highpassNodes = HIGHPASS_Q.map((q) => {
        const node = context.createBiquadFilter();
        node.type = "highpass";
        node.frequency.value = frequency;
        node.Q.value = q;
        last = last.connect(node);
        return node;
      });
    }

    if (
      this.settings.noiseSupression === "enhanced" &&
      RNNoiseNode.isLoaded(context)
    ) {
      this.noiseSuppressionNode = new RNNoiseNode(
        context,
        this.settings.speechGate,
      );
      last = last.connect(this.noiseSuppressionNode);

      // Create a new dynamics compressor
      this.compressorNode = context.createDynamicsCompressor();
      this.compressorNode.threshold.value = -3;
      this.compressorNode.knee.value = 0;
      this.compressorNode.ratio.value = 20;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.05;
      last = last.connect(this.compressorNode);
    }

    last.connect(this.gainNode!);
  }

  private async build(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
    // If context was passed, store it for restarts
    // If no context was passed, this was a restart so use the old context
    let context = opts.audioContext;
    if (!context) {
      context = this.audioContext!;
    } else if (context !== this.audioContext) {
      this.audioContext?.removeEventListener("statechange", this.updateBlocked);
      this.audioContext = context;
      context.addEventListener("statechange", this.updateBlocked);
    }
    if (!context) {
      return;
    }
    await this.loadNoiseSuppression(context);

    this.sourceNode = context.createMediaStreamSource(
      new MediaStream([opts.track]),
    );

    // Create the target gain node for input volume
    this.gainNode = context.createGain();
    this.gainNode.gain.value = this.settings.inputVolume;

    this.connectProcessing(context);

    // Create the destination node, connect the gain node and send it off to livekit
    this.destinationNode = context.createMediaStreamDestination();
    this.gainNode.connect(this.destinationNode);
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];

    this.updateBlocked();
    this.resume();
  }

  private async teardown() {
    this.disconnectProcessing();
    this.gainNode?.disconnect();
    this.destinationNode?.disconnect();
    this.sourceNode = undefined;
    this.gainNode = undefined;
    this.destinationNode = undefined;
  }
}
