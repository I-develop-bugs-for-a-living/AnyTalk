import { Show, createEffect, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";

import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  AudioDeviceMenuPopup,
  DeviceGroup,
  createDeviceList,
} from "./AudioDeviceMenu";

/**
 * Choose the microphone and the speaker for the call. Only shown when there
 * is a choice. Picking a device calls `setAudioInput` / `setAudioOutput`
 * straight from the click, because Safari only lets pages switch the output
 * inside a user gesture.
 */
export function AudioDevicesButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const state = useState();
  const { t } = useLingui();

  const inputs = createDeviceList(
    "audioinput",
    () => state.voice.preferredAudioInputDevice,
  );
  const outputs = createDeviceList(
    "audiooutput",
    () => state.voice.preferredAudioOutputDevice,
  );
  const hasChoice = () =>
    inputs.devices().length > 1 || outputs.devices().length > 1;

  const [anchor, setAnchor] = createSignal<HTMLDivElement>();
  const [open, setOpen] = createSignal(false);
  // whether the menu was opened from the keyboard
  const [byKeyboard, setByKeyboard] = createSignal(false);

  // close the menu when the call ends or the choice disappears
  createEffect(() => {
    if (!hasChoice()) setOpen(false);
  });

  /**
   * Pick a device, called straight from the click handler (gesture!)
   * @param kind Which kind of device
   * @param deviceId Device ID
   */
  function pick(kind: "audioinput" | "audiooutput", deviceId: string) {
    if (kind === "audioinput") voice.setAudioInput(deviceId);
    else voice.setAudioOutput(deviceId);
    setOpen(false);
  }

  return (
    <Show when={hasChoice()}>
      <div
        ref={setAnchor}
        onKeyDown={(event) => {
          // the button itself opens it with Enter or Space (as a click)
          if (event.key === "Escape" && open()) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <IconButton
          size={props.size}
          variant="tonal"
          aria-label={t`Audio devices`}
          aria-haspopup="menu"
          aria-expanded={open()}
          onPress={(event: { pointerType?: string }) => {
            setByKeyboard(event?.pointerType === "keyboard");
            setOpen((o) => !o);
          }}
          use:floating={{
            tooltip: {
              placement: "top",
              content: t`Audio devices`,
            },
          }}
        >
          <Symbol>headset_mic</Symbol>
        </IconButton>

        <AudioDeviceMenuPopup
          anchor={anchor()}
          open={open()}
          byKeyboard={byKeyboard()}
          label={t`Audio devices`}
          onClose={() => setOpen(false)}
        >
          <DeviceGroup
            label={t`Microphone`}
            symbol="mic"
            devices={inputs.devices()}
            activeId={inputs.activeId()}
            onPick={(id) => pick("audioinput", id)}
          />
          <DeviceGroup
            label={t`Speaker`}
            symbol="speaker"
            devices={outputs.devices()}
            activeId={outputs.activeId()}
            onPick={(id) => pick("audiooutput", id)}
          />
        </AudioDeviceMenuPopup>
      </div>
    </Show>
  );
}
