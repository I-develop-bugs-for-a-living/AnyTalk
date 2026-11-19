/** Output sample rate of per-process app audio. */
export const APP_AUDIO_RATE = 48_000;

/** Output channel count of per-process app audio. */
export const APP_AUDIO_CHANNELS = 2;

/**
 * Audio waiting to be played, as a ring of interleaved stereo frames. It
 * smooths over the uneven arrival of chunks: playback only starts once
 * `prefill` frames are queued, goes silent (and waits again) when it runs
 * dry, and when more arrives than fits it drops the oldest sound down to the
 * prefill level.
 */
export class AppAudioRing {
  /** Interleaved samples. */
  readonly #data: Float32Array;
  /** Frames the ring can hold. */
  readonly #capacity: number;
  /** Frames to queue before playing (again). */
  readonly #prefill: number;
  /** Frame index of the next read, always below the capacity. */
  #readAt = 0;
  /** Frames queued. */
  #filled = 0;
  /** Whether playback is running, false while priming. */
  #playing = false;

  /**
   * @param capacity Most frames held, older ones are dropped beyond it
   * @param prefill Frames to queue before playing starts, at most capacity
   */
  constructor(capacity: number, prefill: number) {
    this.#capacity = capacity;
    this.#prefill = Math.min(prefill, capacity);
    this.#data = new Float32Array(capacity * APP_AUDIO_CHANNELS);
  }

  /** Frames queued right now. */
  get queued(): number {
    return this.#filled;
  }

  /** Whether playback is running (false while waiting for the prefill). */
  get playing(): boolean {
    return this.#playing;
  }

  /**
   * Queue interleaved stereo samples.
   *
   * @param samples Interleaved samples, an odd trailing sample is ignored
   * @returns Number of frames dropped to make room (oldest first)
   */
  write(samples: Float32Array): number {
    let frames = Math.floor(samples.length / APP_AUDIO_CHANNELS);
    let from = 0;
    let dropped = 0;
    // a chunk bigger than the ring: only its newest part can stay
    if (frames > this.#capacity) {
      dropped += frames - this.#capacity;
      from = (frames - this.#capacity) * APP_AUDIO_CHANNELS;
      frames = this.#capacity;
    }
    // Not enough room: drop the oldest queued frames down to the prefill
    // level (counting this chunk), a short cut now instead of a click on
    // every further overrun
    if (this.#filled + frames > this.#capacity) {
      const keep = Math.max(0, Math.min(this.#filled, this.#prefill - frames));
      const overflow = this.#filled - keep;
      this.#readAt = (this.#readAt + overflow) % this.#capacity;
      this.#filled -= overflow;
      dropped += overflow;
    }
    let at = (this.#readAt + this.#filled) % this.#capacity;
    for (let i = 0; i < frames; i++) {
      const src = from + i * APP_AUDIO_CHANNELS;
      const dst = at * APP_AUDIO_CHANNELS;
      this.#data[dst] = samples[src];
      this.#data[dst + 1] = samples[src + 1];
      at = at + 1 === this.#capacity ? 0 : at + 1;
    }
    this.#filled += frames;
    if (!this.#playing && this.#filled >= this.#prefill) this.#playing = true;
    return dropped;
  }

  /**
   * Take frames out. Missing frames are written as silence, and running dry
   * makes playback wait for the prefill again.
   *
   * @param left Output for the left channel
   * @param right Output for the right channel, same length as `left`
   * @returns Number of real frames written (the rest is silence)
   */
  read(left: Float32Array, right: Float32Array): number {
    const wanted = left.length;
    const take = this.#playing ? Math.min(wanted, this.#filled) : 0;
    let at = this.#readAt;
    for (let i = 0; i < take; i++) {
      left[i] = this.#data[at * APP_AUDIO_CHANNELS];
      right[i] = this.#data[at * APP_AUDIO_CHANNELS + 1];
      at = at + 1 === this.#capacity ? 0 : at + 1;
    }
    left.fill(0, take);
    right.fill(0, take);
    this.#readAt = at;
    this.#filled -= take;
    if (this.#playing && this.#filled === 0) this.#playing = false;
    return take;
  }
}
