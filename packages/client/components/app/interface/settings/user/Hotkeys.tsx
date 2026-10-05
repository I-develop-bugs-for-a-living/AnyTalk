import { For, JSX, Show, createSignal, onCleanup } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import {
  CUSTOMISABLE_ACTIONS,
  KeybindAction,
  MODIFIER_KEYS,
  defaultSequence,
  formatSequence,
  globalHotkeyStatus,
  sequenceToGlobalAccelerator,
} from "@revolt/keybinds";
import { useState } from "@revolt/state";
import { CustomKeybind } from "@revolt/state/stores/Settings";
import { Button, CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/** Command that lists AnyTalk's global shortcuts on Hyprland. */
const HYPRCTL_COMMAND = "hyprctl globalshortcuts";

/** Example Hyprland config line that binds one AnyTalk shortcut. */
const HYPRLAND_BIND_EXAMPLE =
  "bind = CTRL ALT, M, global, tech.anyportal.AnyTalk:<id>";

/**
 * Turn hotkeys on or off and change their keys
 */
export function HotkeysSettings() {
  const { t } = useLingui();
  const state = useState();

  const labels: Record<string, { title: JSX.Element; icon: string }> = {
    [KeybindAction.VOICE_TOGGLE_MUTE]: {
      title: <Trans>Toggle mute</Trans>,
      icon: "mic_off",
    },
    [KeybindAction.VOICE_TOGGLE_DEAFEN]: {
      title: <Trans>Toggle deafen</Trans>,
      icon: "headset_off",
    },
  };

  /** Keybind currently waiting for keys */
  const [recording, setRecording] = createSignal<KeybindAction>();
  /** Modifiers held while recording, for the preview */
  const [held, setHeld] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string>();

  const custom = () => state.settings.getValue("keybinds:custom") ?? {};

  function current(action: KeybindAction): CustomKeybind {
    return (
      custom()[action] ?? {
        enabled: true,
        keys: defaultSequence(action).filter(
          (key): key is string => typeof key === "string",
        ),
      }
    );
  }

  /**
   * Describe why a hotkey can't work outside AnyTalk (desktop only), if it can't
   */
  function globalProblem(action: KeybindAction) {
    if (!window.native || !current(action).enabled) return;
    if (!sequenceToGlobalAccelerator(current(action).keys))
      return t`These keys only work inside AnyTalk. Use Ctrl, Alt or Shift with a letter or number, or an F key, to use them everywhere.`;
    if (globalHotkeyStatus()[action] === false)
      return t`Another app is already using these keys, so they only work inside AnyTalk. Pick other keys.`;
  }

  function save(action: KeybindAction, value: CustomKeybind) {
    state.settings.setValue("keybinds:custom", {
      ...custom(),
      [action]: value,
    });
  }

  function reset(action: KeybindAction) {
    const { [action]: _, ...rest } = custom();
    state.settings.setValue("keybinds:custom", rest);
  }

  const modifiersOf = (event: KeyboardEvent) =>
    MODIFIER_KEYS.filter((key) => event.getModifierState(key));

  /**
   * Capture keys before the keybind handler sees them, so recording a combo
   * doesn't also trigger it
   */
  function onKeyDown(event: KeyboardEvent) {
    const action = recording();
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();

    const modifiers = modifiersOf(event);
    setHeld(modifiers);

    if (MODIFIER_KEYS.includes(event.key)) return;

    if (event.key === "Escape" && !modifiers.length) {
      stopRecording();
      return;
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    // a bare letter would fire while typing messages
    if (key.length === 1 && !modifiers.length) {
      setError(t`Hold Ctrl, Alt or Shift together with a letter or number.`);
      return;
    }

    const keys = [...modifiers, key];
    const combo = formatSequence(keys);
    const clash = CUSTOMISABLE_ACTIONS.find(
      (other) =>
        other !== action && formatSequence(current(other).keys) === combo,
    );

    if (clash) {
      setError(t`${combo} is already used for another hotkey.`);
      return;
    }

    save(action, { enabled: true, keys });
    stopRecording();
  }

  function onKeyUp(event: KeyboardEvent) {
    if (!recording()) return;
    event.preventDefault();
    event.stopPropagation();
    setHeld(modifiersOf(event));
  }

  function startRecording(action: KeybindAction) {
    stopRecording();
    setRecording(action);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", stopRecording);
  }

  function stopRecording() {
    setRecording();
    setHeld([]);
    setError();
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("keyup", onKeyUp, { capture: true });
    window.removeEventListener("blur", stopRecording);
  }

  onCleanup(stopRecording);

  return (
    <Column>
      <Text class="label">
        <Show
          when={window.native}
          fallback={
            <Trans>
              Hotkeys work while AnyTalk is the focused window or tab. Click a
              hotkey to record new keys, press Escape to cancel.
            </Trans>
          }
        >
          <Trans>
            Hotkeys work everywhere on your computer, even when AnyTalk isn't
            focused. Click a hotkey to record new keys, press Escape to cancel.
          </Trans>
        </Show>
      </Text>
      <Show when={window.native?.isWayland?.()}>
        <Show
          when={window.native?.desktopEnvironment?.includes("Hyprland")}
          fallback={
            <Text class="label">
              <Trans>
                Global hotkeys depend on your desktop environment. On KDE and
                GNOME you may be asked for permission the first time.
              </Trans>
            </Text>
          }
        >
          <Text class="label">
            <Trans>
              Hyprland doesn't assign keys to app shortcuts on its own. Run{" "}
              <code>{HYPRCTL_COMMAND}</code> to see AnyTalk's entries, then bind
              each one in your Hyprland config with the global dispatcher, for
              example <code>{HYPRLAND_BIND_EXAMPLE}</code>.
            </Trans>
          </Text>
        </Show>
      </Show>
      <Text class="title">
        <Trans>Calls</Trans>
      </Text>
      <CategoryButton.Group>
        <For each={CUSTOMISABLE_ACTIONS}>
          {(action) => (
            <>
              <CategoryButton
                icon={<Symbol>{labels[action].icon}</Symbol>}
                onClick={() =>
                  save(action, {
                    ...current(action),
                    enabled: !current(action).enabled,
                  })
                }
                description={
                  <>
                    <Show when={recording() === action && error()}>
                      <ErrorText>{error()}</ErrorText>
                    </Show>
                    <Show when={globalProblem(action)}>
                      <ErrorText role="alert">
                        {globalProblem(action)}
                      </ErrorText>
                    </Show>
                  </>
                }
                action={[
                  <Combo
                    onClick={(e) => e.stopPropagation()}
                    aria-disabled={!current(action).enabled}
                  >
                    <Button
                      size="sm"
                      variant={recording() === action ? "filled" : "tonal"}
                      onPress={() =>
                        recording() === action
                          ? stopRecording()
                          : startRecording(action)
                      }
                    >
                      <Show
                        when={recording() === action}
                        fallback={formatSequence(current(action).keys)}
                      >
                        {held().length ? (
                          `${formatSequence(held())} + …`
                        ) : (
                          <Trans>Press keys…</Trans>
                        )}
                      </Show>
                    </Button>
                    <Show when={custom()[action]}>
                      <Button
                        size="sm"
                        variant="text"
                        onPress={() => reset(action)}
                        use:floating={{
                          tooltip: {
                            placement: "top",
                            content: t`Reset to ${formatSequence(
                              defaultSequence(action),
                            )}`,
                          },
                        }}
                      >
                        <Symbol>restart_alt</Symbol>
                      </Button>
                    </Show>
                  </Combo>,
                  <Checkbox checked={current(action).enabled} />,
                ]}
              >
                {labels[action].title}
              </CategoryButton>
            </>
          )}
        </For>
      </CategoryButton.Group>
    </Column>
  );
}

const Combo = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-xs)",
    fontVariantNumeric: "tabular-nums",
    "&[aria-disabled=true]": {
      opacity: 0.5,
    },
  },
});

const ErrorText = styled("span", {
  base: {
    color: "var(--md-sys-color-error)",
  },
});
