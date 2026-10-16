import { createEffect, on, onCleanup } from "solid-js";

import {
  gamepadPushToTalkAvailable,
  parsePttButton,
  setGamepadPushToTalkAvailable,
} from "@revolt/gamepad";
import { useState } from "@revolt/state";

import { useVoice } from "../state";

/**
 * Desktop only: tells the shell which controller button is push to talk and
 * feeds its presses to the call. Mounted for the whole session, so the shell
 * is told on startup and after a reload, not only in a call. The controller
 * is a separate source from the keyboard; the mic stays open while either
 * holds it. It only matters in the push to talk input mode.
 */
export function GamepadPushToTalk() {
  const state = useState();
  const voice = useVoice();

  const button = () =>
    parsePttButton(state.settings.getValue("controller:ptt_button"));

  // send the setting on start and when it changes
  createEffect(() => {
    const current = button();
    let stale = false;
    onCleanup(() => (stale = true));

    // a different button, or none, lets go of the old one
    voice.releasePushToTalkSource("pad");

    const set = window.native?.setGamepadPushToTalk;
    if (!set) {
      setGamepadPushToTalkAvailable(current ? false : undefined);
      return;
    }
    set
      .call(window.native, current)
      .then((active) => {
        if (stale) return;
        setGamepadPushToTalkAvailable(current ? active : undefined);
        if (!active) voice.releasePushToTalkSource("pad");
      })
      .catch((err) => {
        console.warn("[ptt] could not set the controller button", err);
        if (!stale) setGamepadPushToTalkAvailable(current ? false : undefined);
      });
  });

  // the shell can report the button as unavailable later on
  createEffect(
    on(gamepadPushToTalkAvailable, (available) => {
      if (available === false) voice.releasePushToTalkSource("pad");
    }),
  );

  const stop = window.native?.onGamepadPushToTalk?.((down) => {
    if (gamepadPushToTalkAvailable() === true && button())
      voice.pushToTalk(down, "pad");
  });

  onCleanup(() => {
    stop?.();
    voice.releasePushToTalkSource("pad");
    void window.native?.setGamepadPushToTalk?.(null);
  });

  return null;
}
