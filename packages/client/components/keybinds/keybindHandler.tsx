import {
  type JSXElement,
  createContext,
  createEffect,
  onCleanup,
  untrack,
  useContext,
} from "solid-js";

import { ReactiveSet } from "@solid-primitives/set";

import { useState } from "@revolt/state";

import {
  ACTION_PRIORITY,
  CUSTOMISABLE_ACTIONS,
  KeybindAction,
  PREVENT_DEFAULT_ACTIONS,
  keybindFilter,
} from "./keybindActions";
import {
  DEFAULT_MAC_SEQUENCES,
  DEFAULT_SEQUENCES,
  MODIFIER_KEYS,
} from "./keybindSequences";

type KeybindContext = {
  createKeybind: (keybind: KeybindAction, callback: () => void) => void;
  triggerKeybind: (keybind: KeybindAction) => void;
};

const keybindContext = createContext<KeybindContext>(null! as KeybindContext);

export function KeybindContext(props: { children: JSXElement }) {
  /**
   * Last event target, used for filtering
   */
  let target: HTMLElement | null;

  /**
   * Keep track of pressed keys to match sequences
   */
  const activeKeys = new ReactiveSet<string>();

  /**
   * Keep track of which keybinds are currently bound
   * to filter the firing keybindings list
   */
  const currentlyBound = ACTION_PRIORITY.reduce(
    (d, k) => ({ ...d, [k]: 0 }),
    {} as Record<KeybindAction, number>,
  );

  /**
   * Sequences for use
   */
  const sequences = navigator.platform.startsWith("Mac")
    ? DEFAULT_MAC_SEQUENCES
    : DEFAULT_SEQUENCES;

  /**
   * Callbacks registered per keybind, so an action can be run without keys
   */
  const callbacks = new Map<KeybindAction, Set<() => void>>();

  const state = useState();

  /**
   * Keys for a keybind, taking the user's changes into account
   */
  function sequenceOf(keybind: KeybindAction) {
    const custom = CUSTOMISABLE_ACTIONS.includes(keybind)
      ? state.settings.getValue("keybinds:custom")?.[keybind]
      : undefined;
    return {
      enabled: custom?.enabled ?? true,
      keys: custom?.keys ?? sequences[keybind],
    };
  }

  /**
   * Whether a keybind's keys are held; customisable keybinds also need the
   * exact modifiers, so Ctrl+M doesn't fire while pressing Ctrl+Shift+M
   */
  function isPressed(keybind: KeybindAction) {
    const { enabled, keys } = sequenceOf(keybind);
    if (!enabled) return false;

    if (
      CUSTOMISABLE_ACTIONS.includes(keybind) &&
      MODIFIER_KEYS.some((key) => activeKeys.has(key) !== keys.includes(key))
    )
      return false;

    return keys.every((key) =>
      key instanceof RegExp
        ? [...activeKeys].findIndex((item) => key.test(item)) !== -1
        : activeKeys.has(key),
    );
  }

  /**
   * Get the currently firing keybind
   */
  function firing() {
    return (
      ACTION_PRIORITY
        // filter to those keybinds that are bound
        .filter((keybind) => currentlyBound[keybind])
        // apply custom filtering logic
        .filter((keybind) =>
          keybindFilter(keybind, activeKeys, currentlyBound, target),
        )
        // check whether the keybind is being pressed
        .filter(isPressed)
        // return the highest priority keybind
        .shift()
    );
  }

  /**
   * Debug currently pressed sequences
   */
  if (import.meta.env.DEV) {
    createEffect(() =>
      console.debug(
        "[keybinds] Currently pressing",
        [...activeKeys],
        "which selects",
        ACTION_PRIORITY
          // filter to those keybinds that are bound
          .filter((keybind) => currentlyBound[keybind])
          // apply custom filtering logic
          .filter((keybind) =>
            keybindFilter(keybind, activeKeys, currentlyBound, target),
          )
          // check whether the keybind is being pressed
          .reduce(
            (d, keybind) => ({
              ...d,
              [keybind]: isPressed(keybind),
            }),
            {},
          ),
      ),
    );
  }

  /**
   * Check whether a given keybind fired
   * @param keybind Keybind
   */
  function isFired(keybind: KeybindAction) {
    return firing() === keybind;
  }

  /**
   * Letters in lower case, so releasing Shift before the letter (which
   * changes event.key) can't leave the key stuck as pressed
   */
  const keyOf = (event: KeyboardEvent) =>
    event.key.length === 1 ? event.key.toLowerCase() : event.key;

  /** Key each physical key added to activeKeys */
  const heldByCode = new Map<string, string>();

  /**
   * Handle key down event by adding it to active keys
   */
  function onKeyDown(event: KeyboardEvent) {
    target = event.target as HTMLElement;
    const key = keyOf(event);
    heldByCode.set(event.code, key);
    activeKeys.add(key);

    const action = firing();
    if (action && PREVENT_DEFAULT_ACTIONS.has(action)) event.preventDefault();
  }

  /**
   * Handle key up event by removing it from active keys
   */
  function onKeyUp(event: KeyboardEvent) {
    target = event.target as HTMLElement;
    // release whatever this physical key pressed, even if Shift has since
    // changed what it types
    activeKeys.delete(heldByCode.get(event.code) ?? keyOf(event));
    heldByCode.delete(event.code);
  }

  function onFocusDropped(_: FocusEvent) {
    activeKeys.clear();
    heldByCode.clear();
  }

  document.body.addEventListener("keydown", onKeyDown);
  document.body.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onFocusDropped);

  onCleanup(() => {
    document.body.removeEventListener("keydown", onKeyDown);
    document.body.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onFocusDropped);
  });

  return (
    <keybindContext.Provider
      value={{
        createKeybind(keybind, callback) {
          currentlyBound[keybind]++;
          onCleanup(() => currentlyBound[keybind]--);

          const set = callbacks.get(keybind) ?? new Set();
          callbacks.set(keybind, set);
          set.add(callback);
          onCleanup(() => set.delete(callback));

          createEffect(() => {
            const _ = [...activeKeys]; // track dependency
            if (isFired(keybind)) {
              untrack(callback);
            }
          });
        },
        triggerKeybind(keybind) {
          // skip the key and focus filters, the caller already decided
          for (const callback of [...(callbacks.get(keybind) ?? [])]) {
            untrack(callback);
          }
        },
      }}
    >
      {props.children}
    </keybindContext.Provider>
  );
}

/**
 * Wrapper for contextual createKeybind function
 * @param keybind Keybind
 * @param callback Callback
 */
export function createKeybind(keybind: KeybindAction, callback: () => void) {
  const { createKeybind } = useContext(keybindContext);
  createKeybind(keybind, callback);
}

/**
 * Get a function that runs a keybind's callbacks without its keys being
 * pressed (e.g. when the desktop app reports a global hotkey). It does
 * nothing if the keybind isn't bound at that moment.
 */
export function useTriggerKeybind() {
  return useContext(keybindContext).triggerKeybind;
}

/**
 * Declarative keybind component
 */
export function Keybind(props: {
  keybind: KeybindAction;
  onPressed: () => void;
}) {
  createEffect(() => createKeybind(props.keybind, props.onPressed));
  return null;
}
