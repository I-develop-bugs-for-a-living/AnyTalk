import { State } from "..";

import { AbstractStore } from ".";

/**
 * Possible noise suppresion states. Browser is browser noise suppresion and enhanced is machine learning suppression via RNNoise.
 */
export type NoiseSuppresionState = "disabled" | "browser" | "enhanced";

const NoiseSuppresionStates: NoiseSuppresionState[] = [
  "disabled",
  "browser",
  "enhanced",
];

/**
 * Screen share resolutions. "source" is the native size of the shared screen or window.
 */
export type ScreenShareResolution = "720p" | "1080p" | "1440p" | "source";

/**
 * Screen share resolutions, smallest first.
 */
export const ScreenShareResolutions: ScreenShareResolution[] = [
  "720p",
  "1080p",
  "1440p",
  "source",
];

/**
 * The wanted resolution, or the closest smaller one that is allowed
 */
export function closestScreenShareResolution(
  wanted: ScreenShareResolution,
  allowed: ScreenShareResolution[],
): ScreenShareResolution {
  for (let i = ScreenShareResolutions.indexOf(wanted); i >= 0; i--) {
    if (allowed.includes(ScreenShareResolutions[i])) {
      return ScreenShareResolutions[i];
    }
  }
  return "720p";
}

/**
 * Screen share frame rates.
 */
export type ScreenShareFrameRate = 5 | 15 | 30 | 60;

/**
 * Available screen share frame rates.
 */
export const ScreenShareFrameRates: ScreenShareFrameRate[] = [5, 15, 30, 60];

/**
 * Legacy combined quality names, migrated to resolution + frame rate.
 */
const LEGACY_SCREEN_SHARE_QUALITIES: Record<
  string,
  [ScreenShareResolution, ScreenShareFrameRate]
> = {
  low: ["720p", 30],
  high: ["1080p", 30],
  high60: ["1080p", 60],
  qhd30: ["1440p", 30],
  qhd60: ["1440p", 60],
  source30: ["source", 30],
  text: ["source", 5],
};

export interface TypeVoice {
  preferredAudioInputDevice?: string;
  preferredAudioOutputDevice?: string;
  preferredVideoDevice?: string;

  echoCancellation: boolean;
  noiseSupression: NoiseSuppresionState;
  autoGainControl: boolean;

  screenShareResolution: ScreenShareResolution;
  screenShareFrameRate: ScreenShareFrameRate;
  screenShareQualityAsk: boolean;
  screenShareAudio: boolean;
  /** Watching another stream adds it next to the current one(s) */
  multiStream: boolean;

  inputVolume: number;
  outputVolume: number;
  deafen: boolean;
  micOn: boolean;

  userVolumes: Record<string, number>;
  userMutes: Record<string, boolean>;

  screenShareVolumes: Record<string, number>;
  screenShareMutes: Record<string, boolean>;
}

/**
 * Handles enabling and disabling client experiments.
 */
export class Voice extends AbstractStore<"voice", TypeVoice> {
  /**
   * Construct store
   * @param state State
   */
  constructor(state: State) {
    super(state, "voice");
  }

  /**
   * Hydrate external context
   */
  hydrate(): void {
    /** nothing needs to be done */
  }

  /**
   * Generate default values
   */
  default(): TypeVoice {
    return {
      echoCancellation: true,
      noiseSupression: "enhanced",
      autoGainControl: true,
      screenShareResolution: "1080p",
      screenShareFrameRate: 30,
      screenShareQualityAsk: true,
      screenShareAudio: true,
      multiStream: true,
      inputVolume: 1.0,
      outputVolume: 1.0,
      deafen: false,
      micOn: true,
      userVolumes: {},
      userMutes: {},
      screenShareVolumes: {},
      screenShareMutes: {},
    };
  }

  /**
   * Validate the given data to see if it is compliant and return a compliant object
   */
  clean(input: Partial<TypeVoice>): TypeVoice {
    const data = this.default();

    if (typeof input.preferredAudioInputDevice === "string") {
      data.preferredAudioInputDevice = input.preferredAudioInputDevice;
    }

    if (typeof input.preferredAudioOutputDevice === "string") {
      data.preferredAudioOutputDevice = input.preferredAudioOutputDevice;
    }

    if (typeof input.preferredVideoDevice === "string") {
      data.preferredVideoDevice = input.preferredVideoDevice;
    }

    if (typeof input.echoCancellation === "boolean") {
      data.echoCancellation = input.echoCancellation;
    }

    // migrate legacy noise suppression to new suppression state
    if ((input.noiseSupression as unknown) === "true") {
      data.noiseSupression = "enhanced";
    } else if ((input.noiseSupression as unknown) === "false") {
      data.noiseSupression = "disabled";
    } else if (
      input.noiseSupression &&
      NoiseSuppresionStates.includes(input.noiseSupression)
    ) {
      data.noiseSupression = input.noiseSupression;
    }

    if (typeof input.autoGainControl === "boolean") {
      data.autoGainControl = input.autoGainControl;
    }

    const legacy = (input as { screenShareQuality?: string })
      .screenShareQuality;
    if (legacy && LEGACY_SCREEN_SHARE_QUALITIES[legacy]) {
      [data.screenShareResolution, data.screenShareFrameRate] =
        LEGACY_SCREEN_SHARE_QUALITIES[legacy];
    }

    if (
      input.screenShareResolution &&
      ScreenShareResolutions.includes(input.screenShareResolution)
    ) {
      data.screenShareResolution = input.screenShareResolution;
    }

    if (
      input.screenShareFrameRate &&
      ScreenShareFrameRates.includes(input.screenShareFrameRate)
    ) {
      data.screenShareFrameRate = input.screenShareFrameRate;
    }

    if (typeof input.screenShareQualityAsk === "boolean") {
      data.screenShareQualityAsk = input.screenShareQualityAsk;
    }

    if (typeof input.screenShareAudio === "boolean") {
      data.screenShareAudio = input.screenShareAudio;
    }

    if (typeof input.multiStream === "boolean") {
      data.multiStream = input.multiStream;
    }

    if (typeof input.inputVolume === "number") {
      data.inputVolume = input.inputVolume;
    }

    if (typeof input.outputVolume === "number") {
      data.outputVolume = input.outputVolume;
    }

    if (typeof input.deafen === "boolean") {
      data.deafen = input.deafen;
    }

    if (typeof input.micOn === "boolean") {
      data.micOn = input.micOn;
    }

    if (typeof input.userVolumes === "object") {
      Object.entries(input.userVolumes)
        .filter(
          ([userId, volume]) =>
            typeof userId === "string" && typeof volume === "number",
        )
        .forEach(([k, v]) => (data.userVolumes[k] = v));
    }

    if (typeof input.userMutes === "object") {
      Object.entries(input.userMutes)
        .filter(
          ([userId, muted]) => typeof userId === "string" && muted === true,
        )
        .forEach(([k, v]) => (data.userMutes[k] = v));
    }

    if (typeof input.screenShareVolumes === "object") {
      Object.entries(input.screenShareVolumes)
        .filter(
          ([userId, volume]) =>
            typeof userId === "string" && typeof volume === "number",
        )
        .forEach(([k, v]) => (data.screenShareVolumes[k] = v));
    }

    if (typeof input.screenShareMutes === "object") {
      Object.entries(input.screenShareMutes)
        .filter(
          ([userId, muted]) => typeof userId === "string" && muted === true,
        )
        .forEach(([k, v]) => (data.screenShareMutes[k] = v));
    }

    return data;
  }

  /**
   * Set a user's volume
   * @param userId User ID
   * @param volume Volume
   */
  setUserVolume(userId: string, volume: number) {
    this.set("userVolumes", userId, volume);
  }

  /**
   * Get a user's volume
   * @param userId User ID
   * @returns Volume or default
   */
  getUserVolume(userId: string): number {
    return this.get().userVolumes[userId] ?? 1.0;
  }

  /**
   * Set whether a user is muted
   * @param userId User ID
   * @param muted Whether they should be muted
   */
  setUserMuted(userId: string, muted: boolean) {
    this.set("userMutes", userId, muted);
  }

  /**
   * Get whether a user is muted
   * @param userId User ID
   * @returns Whether muted
   */
  getUserMuted(userId: string): boolean {
    return this.get().userMutes[userId] || false;
  }

  /**
   * Set a user's screen share volume
   * @param userId User ID
   * @param volume Volume
   */
  setScreenShareVolume(userId: string, volume: number) {
    this.set("screenShareVolumes", userId, volume);
  }

  /**
   * Get a user's screen share volume
   * @param userId User ID
   * @returns Volume or default
   */
  getScreenShareVolume(userId: string): number {
    return this.get().screenShareVolumes[userId] ?? 1.0;
  }

  /**
   * Set whether a user's screen share is muted
   * @param userId User ID
   * @param muted Whether they should be muted
   */
  setScreenShareMuted(userId: string, muted: boolean) {
    this.set("screenShareMutes", userId, muted);
  }

  /**
   * Get whether a user's screen share is muted
   * @param userId User ID
   * @returns Whether muted
   */
  getScreenShareMuted(userId: string): boolean {
    return this.get().screenShareMutes[userId] ?? true;
  }

  /**
   * Set the preferred audio input device
   */
  set preferredAudioInputDevice(value: string | undefined) {
    this.set("preferredAudioInputDevice", value);
  }

  /**
   * Set the preferred audio output device
   */
  set preferredAudioOutputDevice(value: string | undefined) {
    this.set("preferredAudioOutputDevice", value);
  }

  /**
   * Set the preferred video input device
   */
  set preferredVideoDevice(value: string | undefined) {
    this.set("preferredVideoDevice", value);
  }

  /**
   * Set echo cancellation
   */
  set echoCancellation(value: boolean) {
    this.set("echoCancellation", value);
  }

  /**
   * Set noise cancellation
   */
  set noiseSupression(value: NoiseSuppresionState) {
    this.set("noiseSupression", value);
  }

  /**
   * Set auto gain control
   */
  set autoGainControl(value: boolean) {
    this.set("autoGainControl", value);
  }

  /**
   * Set screen share resolution
   */
  set screenShareResolution(value: ScreenShareResolution) {
    this.set("screenShareResolution", value);
  }

  /**
   * Set screen share frame rate
   */
  set screenShareFrameRate(value: ScreenShareFrameRate) {
    this.set("screenShareFrameRate", value);
  }

  /**
   * Set screen share quality always ask
   */
  set screenShareQualityAsk(value: boolean) {
    this.set("screenShareQualityAsk", value);
  }

  /**
   * Set screen share audio
   */
  set screenShareAudio(value: boolean) {
    this.set("screenShareAudio", value);
  }

  /**
   * Set whether several streams can be watched at once
   */
  set multiStream(value: boolean) {
    this.set("multiStream", value);
  }

  /**
   * Set input volume
   */
  set inputVolume(value: number) {
    this.set("inputVolume", value);
  }

  /**
   * Set output volume
   */
  set outputVolume(value: number) {
    this.set("outputVolume", value);
  }

  /**
   * Set mic status
   */
  set micOn(value: boolean) {
    this.set("micOn", value);
  }

  /**
   * Set deafen status
   */
  set deafen(value: boolean) {
    this.set("deafen", value);
  }

  /**
   * Get the preferred audio input device
   */
  get preferredAudioInputDevice(): string | undefined {
    return this.get().preferredAudioInputDevice;
  }

  /**
   * Get the preferred audio output device
   */
  get preferredAudioOutputDevice(): string | undefined {
    return this.get().preferredAudioOutputDevice;
  }

  /**
   * Get the preferred video input device
   */
  get preferredVideoDevice(): string | undefined {
    return this.get().preferredVideoDevice;
  }

  /**
   * Get echo cancellation
   */
  get echoCancellation(): boolean | undefined {
    return this.get().echoCancellation;
  }

  /**
   * Get noise supression
   */
  get noiseSupression(): NoiseSuppresionState | undefined {
    return this.get().noiseSupression;
  }

  /**
   * Get auto gain control
   */
  get autoGainControl(): boolean | undefined {
    return this.get().autoGainControl;
  }

  /**
   * Get screen share resolution
   */
  get screenShareResolution(): ScreenShareResolution {
    return this.get().screenShareResolution;
  }

  /**
   * Get screen share frame rate
   */
  get screenShareFrameRate(): ScreenShareFrameRate {
    return this.get().screenShareFrameRate;
  }

  /**
   * Get screen share quality always ask
   */
  get screenShareQualityAsk(): boolean {
    return this.get().screenShareQualityAsk;
  }

  /**
   * Get screen share audio
   */
  get screenShareAudio(): boolean {
    return this.get().screenShareAudio;
  }

  /**
   * Get whether several streams can be watched at once
   */
  get multiStream(): boolean {
    return this.get().multiStream;
  }

  /**
   * Get input volume
   */
  get inputVolume(): number {
    return this.get().inputVolume;
  }

  /**
   * Get output volume
   */
  get outputVolume(): number {
    return this.get().outputVolume;
  }

  /**
   * Get deafen status
   */
  get deafen(): boolean {
    return this.get().deafen;
  }

  /**
   * Get mic status
   */
  get micOn(): boolean {
    return this.get().micOn;
  }
}
