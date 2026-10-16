import { createMemo, createSignal, For, JSX, onCleanup, Show } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import {
  type BindingOverrides,
  type ButtonName,
  type PressButton,
  type PttButton,
  BINDABLE_BUTTONS,
  ButtonCapture,
  CONTROLLER_ACTIONS,
  ControllerAction,
  DEFAULT_BINDINGS,
  ESSENTIAL_ACTIONS,
  gamepadConnected,
  gamepadPushToTalkAvailable,
  isUsablePad,
  parsePttButton,
  PTT_BUTTONS,
  rebind,
  rebindBlocker,
  resetAction,
  resolveBindings,
  setGamepadCapturing,
  snapshotPad,
  unbind,
} from "@revolt/gamepad";
import { globalHotkeyGamepadSupported } from "@revolt/keybinds";
import { useState } from "@revolt/state";
import { Button, CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Game controller settings: turn controller support on or off, see whether a
 * controller is connected, and which button does what
 */
export function ControllerSettings() {
  const state = useState();
  const { t } = useLingui();

  /** Readable names of the buttons that can be push to talk */
  const pttLabels = (): Record<string, string> => ({
    "": t`None`,
    a: t`A (bottom button)`,
    b: t`B (right button)`,
    x: t`X (left button)`,
    y: t`Y (top button)`,
    lb: t`Left bumper (LB)`,
    rb: t`Right bumper (RB)`,
    lt: t`Left trigger (LT)`,
    rt: t`Right trigger (RT)`,
    select: t`View (back) button`,
    start: t`Menu (start) button`,
    l3: t`Left stick click (L3)`,
    r3: t`Right stick click (R3)`,
    up: t`D-pad up`,
    down: t`D-pad down`,
    left: t`D-pad left`,
    right: t`D-pad right`,
  });

  /** Readable names of the buttons */
  const buttonLabels = pttLabels;

  /** Options of the push to talk button select */
  const pttOptions = () => {
    const labels = pttLabels();
    return Object.fromEntries(
      ["", ...PTT_BUTTONS].map((name) => [name, { title: labels[name] }]),
    ) as Record<"" | PttButton, { title: string }>;
  };

  /** Whether controller support is on (it is by default) */
  const enabled = () => state.settings.getValue("controller:enabled") ?? true;

  /** Controls that can't be changed, named by position on the controller */
  const fixed: { button: JSX.Element; action: JSX.Element }[] = [
    {
      button: <Trans>D-pad or left stick</Trans>,
      action: <Trans>Move between buttons, menus and messages</Trans>,
    },
    {
      button: <Trans>Right stick</Trans>,
      action: <Trans>Scroll</Trans>,
    },
  ];

  /** What each action does, as a sentence */
  const actionLabels = (): Record<ControllerAction, string> => ({
    [ControllerAction.ACTIVATE]: t`Press the selected item, or send in the message box`,
    [ControllerAction.BACK]: t`Go back: close a menu or dialog, leave the message box`,
    [ControllerAction.CONTEXT_MENU]: t`Open the context menu of the selected item`,
    [ControllerAction.CYCLE_REGION]: t`Jump between servers, channels, messages and members`,
    [ControllerAction.FOCUS_COMPOSER]: t`Write a message`,
    [ControllerAction.CHANNEL_UP]: t`Previous channel`,
    [ControllerAction.CHANNEL_DOWN]: t`Next channel`,
    [ControllerAction.SERVER_UP]: t`Previous server`,
    [ControllerAction.SERVER_DOWN]: t`Next server`,
    [ControllerAction.TOGGLE_MUTE]: t`Mute or unmute in a call`,
    [ControllerAction.TOGGLE_DEAFEN]: t`Deafen or undeafen in a call`,
  });

  /** Icon of each action */
  const ACTION_ICONS: Record<ControllerAction, string> = {
    [ControllerAction.ACTIVATE]: "touch_app",
    [ControllerAction.BACK]: "arrow_back",
    [ControllerAction.CONTEXT_MENU]: "more_vert",
    [ControllerAction.CYCLE_REGION]: "swap_horiz",
    [ControllerAction.FOCUS_COMPOSER]: "edit",
    [ControllerAction.CHANNEL_UP]: "keyboard_arrow_up",
    [ControllerAction.CHANNEL_DOWN]: "keyboard_arrow_down",
    [ControllerAction.SERVER_UP]: "expand_less",
    [ControllerAction.SERVER_DOWN]: "expand_more",
    [ControllerAction.TOGGLE_MUTE]: "mic_off",
    [ControllerAction.TOGGLE_DEAFEN]: "headset_off",
  };

  /** The user's changes to the buttons */
  const overrides = (): BindingOverrides =>
    state.settings.getValue("controller:bindings") ?? {};

  /** The button of every action right now */
  const bindings = createMemo(() => resolveBindings(overrides()));

  /** Save new changes */
  const save = (next: BindingOverrides) =>
    state.settings.setValue("controller:bindings", next);

  /** The push to talk button, when it takes the button away from navigation */
  const pttButton = () =>
    globalHotkeyGamepadSupported() && gamepadPushToTalkAvailable() === true
      ? parsePttButton(state.settings.getValue("controller:ptt_button"))
      : null;

  /** Screen reader names of the per-row buttons */
  const changeLabel = (action: ControllerAction) => {
    const actionName = actionLabels()[action];
    return t`Change the button for "${actionName}"`;
  };
  const removeLabel = (action: ControllerAction) => {
    const actionName = actionLabels()[action];
    return t`Remove the button for "${actionName}"`;
  };
  const resetLabel = (action: ControllerAction) => {
    const actionName = actionLabels()[action];
    return t`Reset the button for "${actionName}"`;
  };

  /** Action waiting for a button */
  const [recording, setRecording] = createSignal<ControllerAction>();
  /** Why the last press was not accepted */
  const [error, setError] = createSignal<string>();
  /** Text for screen readers about the recording state */
  const [announcement, setAnnouncement] = createSignal("");

  /** Pending animation frame while recording */
  let frame = 0;
  /** Picks the button while recording */
  let capture: ButtonCapture | undefined;

  /**
   * Rebindable buttons held on any controller right now
   * @returns Button names
   */
  function heldButtons(): PressButton[] {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
    const held = new Set<PressButton>();
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected || !isUsablePad(pad)) continue;
      const snapshot = snapshotPad(pad);
      for (const button of BINDABLE_BUTTONS) {
        if (snapshot.pressed[button]) held.add(button);
      }
    }
    return [...held];
  }

  /**
   * Tell screen readers something. The text is cleared first, because an
   * identical text isn't announced twice.
   * @param message Text
   */
  function announce(message: string) {
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
  }

  /**
   * Stop waiting for a button. The controller takes over navigation again; a
   * button still held then is ignored until released.
   * @param message What to tell screen readers
   */
  function stopRecording(message = "") {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    capture = undefined;
    if (recording()) {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
      setGamepadCapturing(false);
      announce(message);
    }
    setRecording();
  }

  /** Escape cancels, since B is a button that can be picked */
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    stopRecording(t`Cancelled.`);
  }

  /** Leaving the window cancels */
  function onBlur() {
    stopRecording(t`Cancelled.`);
  }

  /**
   * Give the recorded button to the action that is waiting for it
   * @param action Action
   * @param button Button that was pressed
   */
  function apply(action: ControllerAction, button: ButtonName) {
    const blocker = rebindBlocker(overrides(), action, button);
    if (blocker) {
      // keep listening, but wait for the button to be released first
      // the error is a role=alert region, so it is announced by itself
      const buttonName = buttonLabels()[button];
      const actionName = actionLabels()[blocker];
      setError(
        t`${buttonName} is needed for "${actionName}". Pick another button.`,
      );
      capture = new ButtonCapture();
      return;
    }

    save(rebind(overrides(), action, button));
    const actionName = actionLabels()[action];
    const buttonName = buttonLabels()[button];
    stopRecording(t`${actionName} is now ${buttonName}.`);
  }

  /** Look at the controllers once per frame while recording */
  function tick() {
    frame = requestAnimationFrame(tick);
    const action = recording();
    if (!action || !capture) return;

    const result = capture.poll(heldButtons(), performance.now());
    if (result.kind === "captured") apply(action, result.button);
    else if (result.kind === "timeout") stopRecording(t`Timed out.`);
  }

  /**
   * Wait for the next button press for an action
   * @param action Action
   */
  function startRecording(action: ControllerAction) {
    stopRecording();
    setError();
    setRecording(action);
    setGamepadCapturing(true);
    capture = new ButtonCapture();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    const actionName = actionLabels()[action];
    announce(
      t`Press a controller button for "${actionName}". Press Escape to cancel.`,
    );
    frame = requestAnimationFrame(tick);
  }

  onCleanup(() => stopRecording());

  /**
   * Put one action back to its default button
   * @param action Action
   */
  function reset(action: ControllerAction) {
    const blocker = resetBlocker(action);
    if (blocker) {
      const actionName = actionLabels()[blocker];
      setError(
        t`The default button is needed for "${actionName}". Reset that one first.`,
      );
      return;
    }
    setError();
    save(resetAction(overrides(), action));
  }

  /**
   * Essential action that holds the default button of an action, if it
   * can't give it up
   * @param action Action
   * @returns The blocking action
   */
  function resetBlocker(action: ControllerAction) {
    const button = DEFAULT_BINDINGS[action];
    return button ? rebindBlocker(overrides(), action, button) : undefined;
  }

  /** Whether an action differs from its default */
  const changed = (action: ControllerAction) =>
    action in overrides() && overrides()[action] !== undefined;

  return (
    <Column gap="lg">
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>sports_esports</Symbol>}
          action={<Checkbox checked={enabled()} />}
          onClick={() =>
            state.settings.setValue("controller:enabled", !enabled())
          }
          description={
            <Trans>
              Use a game controller to move around AnyTalk. Works with Xbox,
              PlayStation, Switch and Steam Deck controllers.
            </Trans>
          }
        >
          <Trans>Controller support</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Show when={globalHotkeyGamepadSupported()}>
        <Column>
          <CategoryButton.Group>
            <CategoryButton.Select
              icon={<Symbol>mic</Symbol>}
              title={<Trans>Push-to-talk button</Trans>}
              value={
                parsePttButton(
                  state.settings.getValue("controller:ptt_button"),
                ) ?? ""
              }
              options={pttOptions()}
              onUpdate={(value) =>
                state.settings.setValue("controller:ptt_button", value)
              }
            />
          </CategoryButton.Group>
          <Text class="label">
            <Trans>
              Hold this button to talk, even while a game is in front. It only
              applies when the input mode is Push to talk. The game also sees
              the button, so pick one it doesn't use. Works with Xbox
              controllers; PlayStation controllers need Steam Input or
              DS4Windows.
            </Trans>
          </Text>
          <Show when={gamepadPushToTalkAvailable() === false}>
            <div role="alert">
              <Text class="label">
                <Trans>
                  The push-to-talk button isn't available on this computer.
                </Trans>
              </Text>
            </div>
          </Show>
        </Column>
      </Show>

      <Status role="status">
        <Symbol>{gamepadConnected() ? "check_circle" : "info"}</Symbol>
        <Text class="label">
          <Show
            when={gamepadConnected()}
            fallback={
              <Trans>
                No controller found. Connect one and press any button on it.
              </Trans>
            }
          >
            <Trans>A controller is connected.</Trans>
          </Show>
        </Text>
      </Status>

      <Column>
        <Text class="title">
          <Trans>Buttons</Trans>
        </Text>
        <Text class="label">
          <Trans>
            Click a button to give its action another controller button, then
            press the new button. Press Escape to cancel. If the new button
            already has an action, the two swap. Controllers without the
            standard layout only support A, B, X and Y.
          </Trans>
        </Text>
        <div class={liveRegion} role="status" aria-live="polite">
          {announcement()}
        </div>
        <Show when={error()}>
          <ErrorText role="alert">{error()}</ErrorText>
        </Show>
        <CategoryButton.Group>
          <For each={CONTROLLER_ACTIONS}>
            {(action) => (
              <CategoryButton
                icon={<Symbol>{ACTION_ICONS[action]}</Symbol>}
                onClick={() =>
                  recording() === action
                    ? stopRecording(t`Cancelled.`)
                    : startRecording(action)
                }
                description={
                  <>
                    <Show
                      when={
                        bindings()[action] !== null &&
                        bindings()[action] === pttButton()
                      }
                    >
                      <ErrorText role="alert">
                        <Trans>
                          This button is the push-to-talk button, so it does
                          nothing else while push to talk is on. Pick another
                          button.
                        </Trans>
                      </ErrorText>
                    </Show>
                    {/* the row starts recording on click, so clicks on these buttons must not reach it */}
                    <Combo onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant={recording() === action ? "filled" : "tonal"}
                        aria-label={changeLabel(action)}
                        onPress={() =>
                          recording() === action
                            ? stopRecording(t`Cancelled.`)
                            : startRecording(action)
                        }
                      >
                        <Show
                          when={recording() === action}
                          fallback={
                            bindings()[action]
                              ? buttonLabels()[bindings()[action]!]
                              : t`Not set`
                          }
                        >
                          <Trans>Press a button…</Trans>
                        </Show>
                      </Button>
                      <Show
                        when={
                          !ESSENTIAL_ACTIONS.has(action) &&
                          bindings()[action] !== null
                        }
                      >
                        <Button
                          size="sm"
                          variant="text"
                          aria-label={removeLabel(action)}
                          onPress={() => {
                            if (recording() === action) stopRecording();
                            setError();
                            save(unbind(overrides(), action));
                          }}
                          use:floating={{
                            tooltip: { placement: "top", content: t`Remove` },
                          }}
                        >
                          <Symbol>link_off</Symbol>
                        </Button>
                      </Show>
                      <Show when={changed(action)}>
                        <Button
                          size="sm"
                          variant="text"
                          aria-label={resetLabel(action)}
                          onPress={() => reset(action)}
                          use:floating={{
                            tooltip: {
                              placement: "top",
                              content: t`Reset to default`,
                            },
                          }}
                        >
                          <Symbol>restart_alt</Symbol>
                        </Button>
                      </Show>
                    </Combo>
                  </>
                }
              >
                {actionLabels()[action]}
              </CategoryButton>
            )}
          </For>
        </CategoryButton.Group>
        <Show when={Object.keys(overrides()).length > 0}>
          <div>
            <Button
              variant="text"
              onPress={() => {
                stopRecording();
                setError();
                save({});
              }}
            >
              <Trans>Reset all buttons</Trans>
            </Button>
          </div>
        </Show>
      </Column>

      <Column>
        <Text class="title">
          <Trans>Fixed controls</Trans>
        </Text>
        <Table>
          <caption class="visually-hidden">
            <Trans>Controls that can't be changed</Trans>
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <Trans>Button</Trans>
              </th>
              <th scope="col">
                <Trans>Action</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={fixed}>
              {(row) => (
                <tr>
                  <th scope="row">{row.button}</th>
                  <td>{row.action}</td>
                </tr>
              )}
            </For>
          </tbody>
        </Table>
      </Column>
    </Column>
  );
}

/** Visually hidden text that screen readers still announce */
const liveRegion = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
});

const Combo = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "4px",
    marginBlockStart: "8px",

    // touch targets of at least 44px
    "& button": { minBlockSize: "44px", minInlineSize: "44px" },
  },
});

const ErrorText = styled("span", {
  base: {
    color: "var(--md-sys-color-error)",
  },
});

const Status = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingInline: "16px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const Table = styled("table", {
  base: {
    width: "100%",
    borderCollapse: "collapse",
    color: "var(--md-sys-color-on-surface)",

    "& caption.visually-hidden": {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      whiteSpace: "nowrap",
    },

    "& th, & td": {
      textAlign: "start",
      paddingBlock: "8px",
      paddingInline: "12px",
      verticalAlign: "top",
      borderBlockEnd: "1px solid var(--md-sys-color-outline-variant)",
    },

    "& thead th": {
      color: "var(--md-sys-color-on-surface-variant)",
      fontWeight: 500,
    },

    "& tbody th": {
      fontWeight: 600,
      whiteSpace: "nowrap",
      _phone: { whiteSpace: "normal" },
    },
  },
});
