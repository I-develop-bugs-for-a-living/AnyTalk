import { KeybindAction, createKeybind } from "@revolt/keybinds";

import { useVoice } from "../state";

/**
 * Mute and deafen hotkeys. Mounted for the whole session so they also work
 * outside calls, where they only change the saved choice for the next call.
 * In a call they respect the channel's speak and listen permissions.
 */
export function MuteKeybinds() {
  const voice = useVoice();

  createKeybind(KeybindAction.VOICE_TOGGLE_MUTE, () => {
    if (!voice.channel() || voice.speakingPermission) voice.toggleMute();
  });

  createKeybind(KeybindAction.VOICE_TOGGLE_DEAFEN, () => {
    if (!voice.channel() || voice.listenPermission) voice.toggleDeafen();
  });

  return null;
}
