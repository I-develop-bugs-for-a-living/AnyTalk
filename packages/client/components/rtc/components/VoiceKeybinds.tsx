import { KeybindAction, createKeybind } from "@revolt/keybinds";

import { useVoice } from "../state";

/**
 * Call hotkeys, active while in a call and the app has focus
 */
export function VoiceKeybinds() {
  const voice = useVoice();

  createKeybind(KeybindAction.VOICE_TOGGLE_MUTE, () => {
    if (voice.speakingPermission) voice.toggleMute();
  });

  createKeybind(KeybindAction.VOICE_TOGGLE_DEAFEN, () => {
    if (voice.listenPermission) voice.toggleDeafen();
  });

  return null;
}
