import { createEffect, createSignal, onCleanup } from "solid-js";

import { overlayAvailable } from "@revolt/rtc/overlayConfig";
import { gameDetectionAvailable } from "@revolt/rtc/runningGames";
import { useState } from "@revolt/state";

import { sequenceToGlobalAccelerator } from "./accelerator";
import { codeOfKey, invertLayout } from "./keyCodes";
import { CUSTOMISABLE_ACTIONS, KeybindAction } from "./keybindActions";
import { useTriggerKeybind, useTriggerKeybindRelease } from "./keybindHandler";
import { MODIFIER_KEYS, defaultSequence } from "./keybindSequences";

const [globalHotkeyStatus, setGlobalHotkeyStatus] = createSignal<
  Record<string, boolean>
>({});

/** Typed character to key code of the current keyboard layout, once loaded */
const [layoutCodes, setLayoutCodes] = createSignal<
  Map<string, string | null> | undefined
>();

/** Load the layout map (Chromium only); without it keys are sent by name */
function loadLayout() {
  const keyboard = (
    navigator as Navigator & {
      keyboard?: { getLayoutMap(): Promise<ReadonlyMap<string, string>> };
    }
  ).keyboard;
  keyboard
    ?.getLayoutMap()
    .then((map) => setLayoutCodes(invertLayout(map)))
    .catch(() => setLayoutCodes(undefined));
}

const [globalHotkeyReleaseSupported, setGlobalHotkeyReleaseSupported] =
  createSignal<boolean>();

/**
 * Whether the desktop shell reports key releases for global hotkeys: true or
 * false once known, undefined before. Without it hold-to-talk hotkeys can only
 * work while AnyTalk is focused.
 */
export { globalHotkeyReleaseSupported };

const [globalHotkeyGamepadSupported, setGlobalHotkeyGamepadSupported] =
  createSignal(false);

/** Whether the desktop shell can read a controller button for push to talk */
export { globalHotkeyGamepadSupported };

/**
 * Whether push to talk is driven by the desktop shell's global press and
 * release: the shell reports releases and the binding is really registered.
 * Otherwise it falls back to the in-app keys.
 */
export function globalPushToTalkActive() {
  return (
    globalHotkeyReleaseSupported() === true &&
    globalHotkeyStatus()[KeybindAction.VOICE_PUSH_TO_TALK] === true
  );
}

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
  const triggerRelease = useTriggerKeybindRelease();

  if (window.native) {
    loadLayout();
    // the layout can change while the app runs
    (
      navigator as Navigator & {
        keyboard?: EventTarget;
      }
    ).keyboard?.addEventListener?.("layoutchange", loadLayout);
    onCleanup(() =>
      (
        navigator as Navigator & { keyboard?: EventTarget }
      ).keyboard?.removeEventListener?.("layoutchange", loadLayout),
    );

    queryCapabilities();
  }

  /** Ask the shell whether it reports releases, older shells can't */
  function queryCapabilities() {
    // older shells have no capabilities call, and so no releases
    (
      window.native.getHotkeyCapabilities?.() ??
      Promise.resolve({ release: false, gamepad: false })
    )
      .then((caps) => {
        setGlobalHotkeyReleaseSupported(!!caps.release);
        setGlobalHotkeyGamepadSupported(!!caps.gamepad);
      })
      .catch(() => {
        setGlobalHotkeyReleaseSupported(false);
        setGlobalHotkeyGamepadSupported(false);
      });
  }

  /** Effective bindings (custom or default) of every enabled action */
  const bindings = () => {
    const custom = state.settings.getValue("keybinds:custom") ?? {};

    return CUSTOMISABLE_ACTIONS.filter(
      (action) =>
        (custom[action]?.enabled ?? true) &&
        // the game stream hotkey is hidden in settings without detection
        (action !== KeybindAction.VOICE_TOGGLE_GAME_STREAM ||
          gameDetectionAvailable()) &&
        // the overlay hotkey needs a desktop build that has the overlay
        (action !== KeybindAction.TOGGLE_OVERLAY || overlayAvailable()) &&
        // hold-to-talk needs releases, else the mic would stay open
        (action !== KeybindAction.VOICE_PUSH_TO_TALK ||
          globalHotkeyReleaseSupported() === true),
    ).flatMap((action) => {
      const keys = custom[action]?.keys ?? defaultSequence(action);
      const accelerator = sequenceToGlobalAccelerator(keys);
      if (!accelerator) return [];
      // the shell matches the physical key, the accelerator names a character
      const main = keys.find(
        (key): key is string =>
          typeof key === "string" && !MODIFIER_KEYS.includes(key),
      );
      const code = main ? codeOfKey(main, layoutCodes()) : undefined;
      return [{ action, accelerator, ...(code ? { code } : {}) }];
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
          // the shell may have lost release support (e.g. its key hook
          // failed): then push to talk leaves the global bindings
          queryCapabilities();
        })
        .catch((err) => {
          console.error("[keybinds] could not set global hotkeys", err);
          if (!stale) setGlobalHotkeyStatus({});
        });
    });

    /**
     * Whether a global press or release should run. While AnyTalk is focused
     * the in-app keybind already handles it (the shell doesn't swallow keys),
     * except push to talk with release support: that is driven only by the
     * global events, so alt-tabbing away with the key held keeps the mic open.
     */
    const accept = (action: string) =>
      (CUSTOMISABLE_ACTIONS as string[]).includes(action) &&
      (!document.hasFocus() ||
        (action === KeybindAction.VOICE_PUSH_TO_TALK &&
          globalPushToTalkActive()));

    // eslint-disable-next-line solid/reactivity -- read when an event arrives, not tracked
    const stop = window.native.onGlobalHotkey?.((action) => {
      if (accept(action)) trigger(action as KeybindAction);
    });
    if (stop) onCleanup(stop);

    // eslint-disable-next-line solid/reactivity -- read when an event arrives, not tracked
    const stopRelease = window.native.onGlobalHotkeyRelease?.((action) => {
      if (accept(action)) triggerRelease(action as KeybindAction);
    });
    if (stopRelease) onCleanup(stopRelease);
  }

  return null;
}
