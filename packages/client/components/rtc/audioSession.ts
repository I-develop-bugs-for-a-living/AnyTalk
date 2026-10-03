/**
 * Tell Safari (16.4+) what kind of audio the page plays
 *
 * Left on "auto", iOS guesses: a Safari tab may start out in plain playback
 * and get switched over once the microphone opens, which reconfigures the
 * audio hardware mid-call. While we capture the microphone we ask for call
 * audio up front, otherwise we leave the choice to the browser again so
 * listening only (and app sounds) keep the better playback mode.
 */

type AudioSessionType =
  | "auto"
  | "playback"
  | "transient"
  | "transient-solo"
  | "ambient"
  | "play-and-record";

const audioSession = (
  navigator as Navigator & { audioSession?: { type: AudioSessionType } }
).audioSession;

/**
 * Switch call audio on or off
 * @param recording Whether the microphone is (about to be) captured
 */
export function setCallAudioSession(recording: boolean) {
  if (!audioSession) return;

  try {
    audioSession.type = recording ? "play-and-record" : "auto";
  } catch (err) {
    console.warn("[rtc] could not set audio session", err);
  }
}
