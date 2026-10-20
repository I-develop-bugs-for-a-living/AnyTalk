import { createEffect, on } from "solid-js";

import {
  KeybindAction,
  createKeybind,
  globalPushToTalkActive,
} from "@revolt/keybinds";

import { useState } from "@revolt/state";

import { useVoice } from "../state";

/**
 * Call hotkeys, active while in a call and the app has focus. Mute and deafen
 * live in MuteKeybinds, which also works outside calls.
 */
export function VoiceKeybinds() {
  const voice = useVoice();
  const state = useState();

  // switching the input mode in settings opens or closes the mic right away
  createEffect(() => {
    void state.voice.inputMode;
    voice.syncMicrophone();
  });

  // With a registered global hotkey that reports releases, push to talk
  // follows only the global events (they also cover the app losing focus with
  // the key held); otherwise only the in-app keys count, and the window
  // losing focus releases the key.
  const usesPress = (global: boolean) => global === globalPushToTalkActive();

  // when the source of push to talk switches between the global hotkey and
  // the in-app keys, the other source's release would be ignored: let go
  createEffect(
    on(globalPushToTalkActive, () => voice.releasePushToTalkSource("keys"), {
      defer: true,
    }),
  );

  createKeybind(
    KeybindAction.VOICE_PUSH_TO_TALK,
    (global) => usesPress(global) && voice.pushToTalk(true),
    (global) => usesPress(global) && voice.pushToTalk(false),
  );

  createKeybind(KeybindAction.VOICE_TOGGLE_GAME_STREAM, () => {
    voice.toggleFocusedGameStream();
  });

  return null;
}
