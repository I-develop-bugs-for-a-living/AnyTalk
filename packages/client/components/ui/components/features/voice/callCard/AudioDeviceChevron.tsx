import { Show, createEffect, createSignal, untrack } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { isIOSBusMode, useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  AudioDeviceMenuPopup,
  DeviceGroup,
  createDeviceList,
} from "./AudioDeviceMenu";

/**
 * Chevron attached to the mute or deafen button (split button) that opens a
 * menu of microphones or speakers. Picking a device calls `setAudioInput` /
 * `setAudioOutput` straight from the click, because Safari only lets pages
 * switch the output inside a user gesture. Hidden when there is no choice,
 * which includes browsers that can't list outputs, and on iPhone and iPad,
 * which ignore the microphone choice and route output with the earpiece
 * toggle instead.
 */
export function AudioDeviceChevron(props: {
  kind: "audioinput" | "audiooutput";
  /** Colours of the button it is attached to */
  variant: "filled" | "tonal";
}) {
  const voice = useVoice();
  // the kind never changes for a chevron
  const kind = untrack(() => props.kind);
  const state = useState();
  const { t } = useLingui();

  const list = createDeviceList(kind, () =>
    kind === "audioinput"
      ? state.voice.preferredAudioInputDevice
      : state.voice.preferredAudioOutputDevice,
  );
  const hasChoice = () => !isIOSBusMode() && list.devices().length > 1;
  const label = () =>
    kind === "audioinput" ? t`Input device` : t`Output device`;

  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [open, setOpen] = createSignal(false);
  // whether the menu was opened from the keyboard
  const [byKeyboard, setByKeyboard] = createSignal(false);

  // close the menu when the choice disappears
  createEffect(() => {
    if (!hasChoice()) setOpen(false);
  });

  /**
   * Pick a device, called straight from the click handler (gesture!)
   * @param deviceId Device ID
   */
  function pick(deviceId: string) {
    if (kind === "audioinput") voice.setAudioInput(deviceId);
    else voice.setAudioOutput(deviceId);
    setOpen(false);
  }

  return (
    <Show when={hasChoice()}>
      <Chevron
        ref={setAnchor}
        type="button"
        variant={props.variant}
        aria-label={label()}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={(event) => {
          // a click without a pointer (detail 0) comes from Enter or Space
          setByKeyboard(event.detail === 0);
          setOpen((o) => !o);
        }}
        onKeyDown={(event) => {
          // arrow keys open the menu, like a menu button
          if (
            (event.key === "ArrowUp" || event.key === "ArrowDown") &&
            !open()
          ) {
            event.preventDefault();
            setByKeyboard(true);
            setOpen(true);
          }
          if (event.key === "Escape" && open()) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        use:floating={{
          tooltip: { placement: "top", content: label() },
        }}
      >
        <Symbol size={20}>expand_less</Symbol>
      </Chevron>
      <AudioDeviceMenuPopup
        anchor={anchor()}
        open={open()}
        byKeyboard={byKeyboard()}
        label={label()}
        onClose={() => setOpen(false)}
      >
        <DeviceGroup
          label={kind === "audioinput" ? t`Microphone` : t`Speaker`}
          symbol={kind === "audioinput" ? "mic" : "speaker"}
          devices={list.devices()}
          activeId={list.activeId()}
          onPick={pick}
        />
      </AudioDeviceMenuPopup>
    </Show>
  );
}

/** Narrow button on the end of a mute or deafen button, same colours */
const Chevron = styled("button", {
  base: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "40px",
    padding: 0,
    border: "none",
    cursor: "pointer",
    transition: "var(--transitions-fast) all",

    borderStartEndRadius: "var(--borderRadius-full)",
    borderEndEndRadius: "var(--borderRadius-full)",
    borderStartStartRadius: "var(--borderRadius-xs)",
    borderEndStartRadius: "var(--borderRadius-xs)",

    color: "var(--colour)",
    fill: "var(--colour)",

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },

    // touch target
    _phone: { width: "44px", height: "44px" },
  },
  variants: {
    variant: {
      filled: {
        background: "var(--md-sys-color-primary)",
        "--colour": "var(--md-sys-color-on-primary)",
      },
      tonal: {
        background: "var(--md-sys-color-secondary-container)",
        "--colour": "var(--md-sys-color-on-secondary-container)",
      },
    },
  },
});
