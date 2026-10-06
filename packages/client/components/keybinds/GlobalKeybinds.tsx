import { createEffect, createSignal, onCleanup } from "solid-js";

import { useState } from "@revolt/state";

import { sequenceToGlobalAccelerator } from "./accelerator";
import { CUSTOMISABLE_ACTIONS, KeybindAction } from "./keybindActions";
import { useTriggerKeybind } from "./keybindHandler";
import { defaultSequence } from "./keybindSequences";

const [globalHotkeyStatus, setGlobalHotkeyStatus] = createSignal<
  Record<string, boolean>
>({});

/**
 * Whether the desktop app could register each global hotkey, by action.
 * Actions that are disabled, or can't be converted, are missing.
 */
export { globalHotkeyStatus };

/**
 * Desktop only: registers the user's hotkeys globally with the native shell and
 * runs the matching keybind when one is pressed while AnyTalk isn't focused
 */
export function GlobalKeybinds() {
  const state = useState();
  const trigger = useTriggerKeybind();

  /** Effective bindings (custom or default) of every enabled action */
  const bindings = () => {
    const custom = state.settings.getValue("keybinds:custom") ?? {};

    return CUSTOMISABLE_ACTIONS.filter(
      (action) => custom[action]?.enabled ?? true,
    ).flatMap((action) => {
      const accelerator = sequenceToGlobalAccelerator(
        custom[action]?.keys ?? defaultSequence(action),
      );
      return accelerator ? [{ action, accelerator }] : [];
    });
  };

  if (window.native?.setGlobalHotkeys) {
    // the native side replaces all bindings on each call, so it also clears
    // them when the list becomes empty
    createEffect(() => {
      const current = bindings();
      let stale = false;
      onCleanup(() => (stale = true));

      window.native
        .setGlobalHotkeys(current)
        .then((results) => {
          if (stale) return;
          setGlobalHotkeyStatus(
            Object.fromEntries(results.map((r) => [r.action, r.registered])),
          );
        })
        .catch((err) => {
          console.error("[keybinds] could not set global hotkeys", err);
          if (!stale) setGlobalHotkeyStatus({});
        });
    });

    const stop = window.native.onGlobalHotkey?.((action) => {
      if ((CUSTOMISABLE_ACTIONS as string[]).includes(action))
        trigger(action as KeybindAction);
    });
    if (stop) onCleanup(stop);
  }

  return null;
}
