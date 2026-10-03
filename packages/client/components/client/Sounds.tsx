import { createContext, JSXElement, useContext } from "solid-js";

import { SoundName, Sounds, useState } from "@revolt/state";

import deafenSound from "../../public/assets/sounds/deafen.ogg";
import messageSound from "../../public/assets/sounds/message_sound.ogg";
import muteSound from "../../public/assets/sounds/mute.ogg";
import ringtoneIncomingSound from "../../public/assets/sounds/ringtone_incoming.ogg";
import ringtoneOutgoingSound from "../../public/assets/sounds/ringtone_outgoing.ogg";
import streamEndSound from "../../public/assets/sounds/stream_end.ogg";
import streamStartSound from "../../public/assets/sounds/stream_start.ogg";
import streamViewerJoinSound from "../../public/assets/sounds/stream_viewer_join.ogg";
import streamViewerLeaveSound from "../../public/assets/sounds/stream_viewer_leave.ogg";
import undeafenSound from "../../public/assets/sounds/undeafen.ogg";
import unmuteSound from "../../public/assets/sounds/unmute.ogg";
import userJoinVoiceSound from "../../public/assets/sounds/user_join_voice.ogg";
import userLeaveVoiceSound from "../../public/assets/sounds/user_leave_voice.ogg";
import userMovedSound from "../../public/assets/sounds/user_moved.ogg";

const SOURCES: Record<SoundName, string> = {
  deafen: deafenSound,
  message: messageSound,
  mute: muteSound,
  ringtoneIncoming: ringtoneIncomingSound,
  ringtoneOutgoing: ringtoneOutgoingSound,
  streamEnd: streamEndSound,
  streamStart: streamStartSound,
  streamViewerJoin: streamViewerJoinSound,
  streamViewerLeave: streamViewerLeaveSound,
  undeafen: undeafenSound,
  unmute: unmuteSound,
  userJoinVoice: userJoinVoiceSound,
  userLeaveVoice: userLeaveVoiceSound,
  userMoved: userMovedSound,
};

/**
 * A controller class for making sure sounds are managed in one place and to prevent undesirable sound overlaps
 */
export class SoundController {
  readonly soundState: Sounds;

  node?: HTMLAudioElement;

  /** Repeating sound, see startLoop */
  loopNode?: HTMLAudioElement;

  lastPlayedSound?: SoundName;

  constructor(soundState: Sounds) {
    this.soundState = soundState;

    this.isPlaying = this.isPlaying.bind(this);
    this.canPlay = this.canPlay.bind(this);
    this.playSound = this.playSound.bind(this);
  }

  /**
   * Get whether a sound is currently being played by the sound controller
   *
   * @returns Whether a sound is currently playing
   */
  isPlaying(): boolean {
    return this.node?.paused ?? false;
  }

  /**
   * Get whether a sound can be played right now
   *
   * @param newSound Sound to check for playability
   * @returns Whether the sound passed is playable currently
   */
  canPlay(newSound: SoundName): boolean {
    // Never let a sound turned off play
    if (!this.soundState.enabled(newSound)) {
      return false;
    }

    // Always let the sound play if nothing is currently playing
    if (!this.isPlaying()) {
      return true;
    }

    // If there are any cases where you don't want sound collisions, put them here.
    // None for now.
    return true;
  }

  /**
   * Play a sound, following the rules of sound playability unless force is true
   *
   * @param sound The sound to play
   * @param force Bypass canPlay check
   * @returns Whether the sound played
   */
  playSound(sound: SoundName, force?: boolean): boolean {
    if (!force && !this.canPlay(sound)) {
      return false;
    }

    this.node = new Audio(SOURCES[sound]);
    this.lastPlayedSound = sound;
    this.node.volume = this.soundState.volume;
    // a muted sound isn't worth playing
    if (this.node.volume > 0) this.node.play().catch(() => {});
    return true;
  }

  /**
   * Play a sound on repeat, e.g. a ringtone, replacing any other repeating
   * sound
   *
   * @param sound The sound to repeat
   * @returns Stops it again
   */
  startLoop(sound: SoundName): () => void {
    this.stopLoop();
    if (!this.canPlay(sound)) return () => {};

    const node = new Audio(SOURCES[sound]);
    node.loop = true;
    node.volume = this.soundState.volume;
    if (node.volume > 0) node.play().catch(() => {});
    this.loopNode = node;

    return () => {
      if (this.loopNode === node) this.stopLoop();
    };
  }

  /**
   * Stop the repeating sound, if any
   */
  stopLoop() {
    this.loopNode?.pause();
    this.loopNode = undefined;
  }
}

const soundContext = createContext(null! as SoundController);

export function SoundContext(props: { children: JSXElement }) {
  const { sounds } = useState();

  const controller = new SoundController(sounds);

  return (
    <soundContext.Provider value={controller}>
      {props.children}
    </soundContext.Provider>
  );
}

export function useSound(): SoundController {
  return useContext(soundContext);
}
