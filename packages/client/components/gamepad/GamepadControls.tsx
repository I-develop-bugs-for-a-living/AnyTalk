import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import { KeybindAction, useTriggerKeybind } from "@revolt/keybinds";
import { useState } from "@revolt/state";

import { ControllerAction, actionForButton, resolveBindings } from "./bindings";
import { gamepadCapturing } from "./capture";
import {
  activate,
  cycleRegion,
  goBack,
  moveFocus,
  openContextMenu,
  scrollPage,
  setGamepadInputMode,
  topLayer,
  watchLayers,
} from "./dom";
import {
  type InputEvent,
  PadTracker,
  isUsablePad,
  maskButton,
  snapshotPad,
} from "./input";
import { gamepadPushToTalkAvailable } from "./pushToTalkButton";

/** Number of controllers that are connected right now */
const [padCount, setPadCount] = createSignal(0);

/**
 * Whether a game controller is connected. Browsers only report a controller
 * after a button was pressed on it.
 * @returns Boolean
 */
export function gamepadConnected(): boolean {
  return padCount() > 0;
}

/**
 * Connected controllers, without the empty slots the browser leaves
 * @returns Controllers
 */
function connectedPads(): Gamepad[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter(
    (pad): pad is Gamepad => !!pad && pad.connected && isUsablePad(pad),
  );
}

/**
 * Lets a game controller drive the app: moving focus, pressing, going back,
 * context menus, switching channels and servers, scrolling and muting. See
 * ARCHITECTURE.md for the button layout.
 *
 * While no controller is connected, or the setting is off, the only thing
 * this listens to is the connect and disconnect events. Polling and the other
 * listeners exist only while a controller is connected, the setting is on and
 * the page is visible.
 */
export function GamepadControls() {
  const state = useState();
  const trigger = useTriggerKeybind();

  /** Whether the user left controller support on */
  const enabled = () => state.settings.getValue("controller:enabled") ?? true;

  /** The push to talk button, which the app must leave alone */
  const pttButton = () =>
    gamepadPushToTalkAvailable() === true
      ? (state.settings.getValue("controller:ptt_button") ?? undefined)
      : undefined;

  /** The button of every action: defaults with the user's changes */
  const bindings = createMemo(() =>
    resolveBindings(state.settings.getValue("controller:bindings")),
  );

  /** Position tracking per controller, by its index */
  const trackers = new Map<number, PadTracker>();

  /** Watches overlays opening, while polling */
  let layerWatch: ReturnType<typeof watchLayers> | undefined;

  /** Pending animation frame, 0 when not polling */
  let frame = 0;

  /**
   * Carry out one thing the controller did
   * @param event Input event
   */
  function handle(event: InputEvent) {
    // while an overlay is open, the navigation keys must not act on the page
    // behind it
    const overlayOpen = !!topLayer();

    switch (event.kind) {
      case "move":
        moveFocus(event.direction);
        return;

      case "scroll":
        scrollPage(event.amount);
        return;

      case "press":
        break;
    }

    switch (actionForButton(bindings(), event.button)) {
      case ControllerAction.ACTIVATE:
        activate();
        return;
      case ControllerAction.BACK:
        goBack();
        return;
      case ControllerAction.CONTEXT_MENU:
        openContextMenu();
        return;
      case ControllerAction.FOCUS_COMPOSER:
        if (!overlayOpen) trigger(KeybindAction.CHAT_FOCUS_COMPOSITION);
        return;
      case ControllerAction.CHANNEL_UP:
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_CHANNEL_UP);
        return;
      case ControllerAction.CHANNEL_DOWN:
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_CHANNEL_DOWN);
        return;
      case ControllerAction.SERVER_UP:
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_SERVER_UP);
        return;
      case ControllerAction.SERVER_DOWN:
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_SERVER_DOWN);
        return;
      case ControllerAction.TOGGLE_MUTE:
        trigger(KeybindAction.VOICE_TOGGLE_MUTE);
        return;
      case ControllerAction.TOGGLE_DEAFEN:
        trigger(KeybindAction.VOICE_TOGGLE_DEAFEN);
        return;
      case ControllerAction.CYCLE_REGION:
        cycleRegion();
        return;
    }
  }

  /**
   * Read every controller once and act on what changed
   */
  function poll() {
    frame = requestAnimationFrame(poll);

    const now = performance.now();

    // a dialog opened while the controller is in use takes focus
    if (document.documentElement.dataset.input === "gamepad") {
      layerWatch?.tick();
    }

    // the settings page is waiting for a button to rebind: nothing may act,
    // and the trackers start over afterwards so a button held then is ignored
    if (gamepadCapturing()) {
      trackers.clear();
      return;
    }

    const pads = connectedPads();

    // forget controllers that went away
    const indexes = new Set(pads.map((pad) => pad.index));
    for (const index of [...trackers.keys()]) {
      if (!indexes.has(index)) trackers.delete(index);
    }

    for (const pad of pads) {
      let tracker = trackers.get(pad.index);
      if (!tracker) {
        tracker = new PadTracker();
        trackers.set(pad.index, tracker);
      }

      const events = tracker.poll(
        maskButton(snapshotPad(pad), pttButton()),
        now,
      );
      if (events.length) setGamepadInputMode(true);

      for (const event of events) {
        try {
          handle(event);
        } catch (error) {
          // one failing action must not stop the controller working
          console.error("[gamepad] Failed to handle input", event, error);
        }
      }
    }
  }

  /**
   * Start polling when the page is visible
   */
  function startPolling() {
    if (frame || document.visibilityState !== "visible") return;
    layerWatch ??= watchLayers();
    frame = requestAnimationFrame(poll);
  }

  /**
   * Stop polling and forget what the controllers were doing, so a button held
   * while the page was hidden doesn't fire when it comes back
   */
  function stopPolling() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    layerWatch?.stop();
    layerWatch = undefined;
    trackers.clear();
  }

  /**
   * Pause while the page is hidden, resume when it is shown again
   */
  function onVisibilityChange() {
    if (document.visibilityState === "visible") startPolling();
    else stopPolling();
  }

  /**
   * Go back to normal focus rings when the mouse, a finger or the keyboard is
   * used. Key events made by this module aren't trusted, so they don't count.
   * @param event Pointer or key event
   */
  function onOtherInput(event: Event) {
    if (event.isTrusted) setGamepadInputMode(false);
  }

  /**
   * Count the controllers, which the settings page shows
   */
  function refreshCount() {
    setPadCount(connectedPads().length);
  }

  onMount(() => {
    refreshCount();
    window.addEventListener("gamepadconnected", refreshCount);
    window.addEventListener("gamepaddisconnected", refreshCount);

    onCleanup(() => {
      window.removeEventListener("gamepadconnected", refreshCount);
      window.removeEventListener("gamepaddisconnected", refreshCount);
    });
  });

  // everything else only while there is something to listen to
  createEffect(
    on(
      () => enabled() && gamepadConnected(),
      (active) => {
        if (!active) return;

        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("pointerdown", onOtherInput, true);
        window.addEventListener("keydown", onOtherInput, true);
        startPolling();

        onCleanup(() => {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          window.removeEventListener("pointerdown", onOtherInput, true);
          window.removeEventListener("keydown", onOtherInput, true);
          stopPolling();
          setGamepadInputMode(false);
        });
      },
    ),
  );

  return null;
}
