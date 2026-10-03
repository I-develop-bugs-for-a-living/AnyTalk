import { State } from "..";

import { AbstractStore } from ".";

/**
 * Every sound the app plays
 */
export const SOUND_NAMES = [
  /** A message or notification arrived */
  "message",
  /** You mute or unmute your microphone */
  "mute",
  "unmute",
  /** You deafen or undeafen */
  "deafen",
  "undeafen",
  /** Someone joins, leaves or moves into / out of your voice channel */
  "userJoinVoice",
  "userLeaveVoice",
  "userMoved",
  /** Someone calls you in a DM or group / you call them */
  "ringtoneIncoming",
  "ringtoneOutgoing",
  /** A stream starts or ends */
  "streamStart",
  "streamEnd",
  /** Someone starts or stops watching your stream */
  "streamViewerJoin",
  "streamViewerLeave",
] as const;

/** Sounds that can be played and turned on or off */
export type SoundName = (typeof SOUND_NAMES)[number];

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const isVolume = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export type TypeSounds = Record<SoundName, boolean> & {
  /**
   * Whether any sound plays at all
   */
  playSounds: boolean;

  /**
   * Volume of all sounds, 0 to 1
   */
  volume: number;

  /**
   * Volume of single sounds relative to the volume of all sounds, 0 to 1
   * (1 when missing)
   */
  volumes: Partial<Record<SoundName, number>>;

  /**
   * Sounds replaced by a file of the user's: the file's name (the file
   * itself is kept in the browser, see @revolt/client/customSounds)
   */
  custom: Partial<Record<SoundName, string>>;
};

export class Sounds extends AbstractStore<"sounds", TypeSounds> {
  constructor(state: State) {
    super(state, "sounds");
  }

  hydrate(): void {}

  default(): TypeSounds {
    return {
      ...(Object.fromEntries(SOUND_NAMES.map((name) => [name, true])) as Record<
        SoundName,
        boolean
      >),
      playSounds: true,
      volume: 1,
      volumes: {},
      custom: {},
    };
  }

  clean(input: Partial<TypeSounds>): TypeSounds {
    const out = this.default();

    for (const name of SOUND_NAMES) {
      if (typeof input[name] === "boolean") out[name] = input[name];

      const volume = input.volumes?.[name];
      if (isVolume(volume)) out.volumes[name] = clamp(volume);

      const custom = input.custom?.[name];
      if (typeof custom === "string") out.custom[name] = custom;
    }

    if (typeof input.playSounds === "boolean")
      out.playSounds = input.playSounds;
    if (isVolume(input.volume)) out.volume = clamp(input.volume);

    return out;
  }

  /**
   * Whether a sound is turned on (sounds may still be off altogether, see
   * playSounds)
   */
  enabled(t: SoundName): boolean {
    return this.get()[t];
  }

  toggle(t: SoundName) {
    return this.set(t, !this.enabled(t));
  }

  /**
   * Whether any sound plays at all
   */
  get playSounds(): boolean {
    return this.get().playSounds;
  }

  set playSounds(value: boolean) {
    this.set("playSounds", value);
  }

  /**
   * Volume of all sounds, 0 to 1
   */
  get volume(): number {
    return this.get().volume;
  }

  set volume(value: number) {
    this.set("volume", clamp(Number(value) || 0));
  }

  /**
   * Volume of a single sound relative to all sounds, 0 to 1
   */
  soundVolume(t: SoundName): number {
    return this.get().volumes[t] ?? 1;
  }

  setSoundVolume(t: SoundName, value: number) {
    this.set("volumes", t, clamp(Number(value) || 0));
  }

  /**
   * Name of the user's file replacing a sound, if any
   */
  customFile(t: SoundName): string | undefined {
    return this.get().custom[t];
  }

  setCustomFile(t: SoundName, fileName: string | undefined) {
    this.set("custom", t, fileName);
  }
}
