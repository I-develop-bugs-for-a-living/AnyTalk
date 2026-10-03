/**
 * Plays app sounds through one AudioContext.
 *
 * Phones (iOS always, Android until the page was tapped) only let an
 * <audio> element play when a tap started it, so sounds triggered by
 * events (ringtones, someone joining, moving or watching your stream)
 * stayed silent. An AudioContext only needs to be started by one
 * interaction, after that anything can play through it.
 */
export class SoundEngine {
  #context?: AudioContext;
  #buffers = new Map<string, Promise<AudioBuffer | undefined>>();

  constructor() {
    if (typeof window === "undefined" || !("AudioContext" in window)) return;

    // browsers only start an AudioContext from an interaction; iOS also
    // pauses it when calls or other apps take over the audio, so keep
    // trying on every interaction until it runs
    const resume = () => {
      const context = this.#getContext();
      if (context && context.state !== "running")
        context.resume().catch(() => {});
    };

    for (const event of ["pointerdown", "touchend", "keydown"])
      window.addEventListener(event, resume, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resume();
    });
  }

  #getContext() {
    if (!this.#context) {
      try {
        this.#context = new AudioContext();
      } catch {
        return undefined;
      }
    }
    return this.#context;
  }

  /**
   * Download and decode a sound file, once
   * @param url File URL
   * @returns Decoded sound, or undefined if it can't be decoded
   */
  #load(url: string) {
    let buffer = this.#buffers.get(url);
    if (!buffer) {
      const context = this.#getContext();
      buffer = context
        ? fetch(url)
            .then((response) => response.arrayBuffer())
            .then((data) => context.decodeAudioData(data))
            .catch((err) => {
              console.error("[sounds] could not decode", url, err);
              return undefined;
            })
        : Promise.resolve(undefined);
      this.#buffers.set(url, buffer);
    }
    return buffer;
  }

  /**
   * Decode sounds ahead of time so they start without delay
   * @param urls File URLs
   */
  preload(urls: string[]) {
    for (const url of urls) this.#load(url);
  }

  /**
   * Drop a decoded sound, e.g. after the user replaced its file
   * @param url File URL
   */
  forget(url: string) {
    this.#buffers.delete(url);
  }

  /**
   * Play a sound file
   * @param url File URL
   * @param volume Volume, 0 to 1
   * @param loop Whether to repeat it until stopped
   * @param fallback Plays the sound some other way if it can't be decoded
   * @returns Stops it, or undefined if sounds can't play this way (yet),
   *  e.g. before the first interaction
   */
  play(
    url: string,
    volume: number,
    loop: boolean,
    fallback: () => () => void,
  ): (() => void) | undefined {
    const context = this.#context;
    if (!context || context.state !== "running") return undefined;

    let stopped = false;
    let stop: (() => void) | undefined;

    this.#load(url).then((buffer) => {
      if (stopped) return;
      if (!buffer) {
        stop = fallback();
        return;
      }

      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = loop;
      gain.gain.value = volume;
      source.connect(gain).connect(context.destination);
      source.onended = () => gain.disconnect();
      source.start();

      stop = () => {
        try {
          source.stop();
        } catch {
          // already ended
        }
      };
    });

    return () => {
      stopped = true;
      stop?.();
    };
  }
}
