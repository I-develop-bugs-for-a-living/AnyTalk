import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";

import { KeybindAction, useTriggerKeybind } from "@revolt/keybinds";
import { useState } from "@revolt/state";

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
import { type InputEvent, PadTracker, isUsablePad, snapshotPad } from "./input";

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

    switch (event.button) {
      case "a":
        activate();
        return;
      case "b":
        goBack();
        return;
      case "x":
        openContextMenu();
        return;
      case "y":
        if (!overlayOpen) trigger(KeybindAction.CHAT_FOCUS_COMPOSITION);
        return;
      case "lb":
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_CHANNEL_UP);
        return;
      case "rb":
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_CHANNEL_DOWN);
        return;
      case "lt":
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_SERVER_UP);
        return;
      case "rt":
        if (!overlayOpen) trigger(KeybindAction.NAVIGATION_SERVER_DOWN);
        return;
      case "select":
        trigger(KeybindAction.VOICE_TOGGLE_MUTE);
        return;
      case "start":
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

      const events = tracker.poll(snapshotPad(pad), now);
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
