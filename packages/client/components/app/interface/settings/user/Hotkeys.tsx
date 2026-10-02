import { For, JSX, Show, createSignal, onCleanup } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import {
  CUSTOMISABLE_ACTIONS,
  KeybindAction,
  MODIFIER_KEYS,
  defaultSequence,
  formatSequence,
} from "@revolt/keybinds";
import { useState } from "@revolt/state";
import { CustomKeybind } from "@revolt/state/stores/Settings";
import { Button, CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

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
        <Trans>
          Hotkeys work while AnyTalk is the focused window or tab. Click a
          hotkey to record new keys, press Escape to cancel.
        </Trans>
      </Text>
      <Text class="title">
        <Trans>Calls</Trans>
      </Text>
      <CategoryButton.Group>
        <For each={CUSTOMISABLE_ACTIONS}>
          {(action) => (
            <CategoryButton
              icon={<Symbol>{labels[action].icon}</Symbol>}
              onClick={() =>
                save(action, {
                  ...current(action),
                  enabled: !current(action).enabled,
                })
              }
              description={
                <Show when={recording() === action && error()}>
                  <ErrorText>{error()}</ErrorText>
                </Show>
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
