import { Show, createEffect, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";

import { ContextMenuButton } from "@revolt/app/menus/ContextMenu";
import { useDevice } from "@revolt/common";
import { useInstance } from "@revolt/instance";
import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  DeviceChevronButton,
  SplitButton,
  chevronMenuHandlers,
} from "./AudioDeviceChevron";
import {
  AudioDeviceMenuPopup,
  DeviceGroup,
  createDeviceList,
} from "./AudioDeviceMenu";

/**
 * Start or stop the camera. With more than one camera, desktop gets a
 * chevron (split button) that opens a menu to pick the camera and, while the
 * camera is on, flip it. Phones get no chevron: a separate flip button
 * follows the camera button instead, while the camera is on.
 */
export function CameraButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const state = useState();
  const { t } = useLingui();
  const { limits } = useInstance();
  const { isMobile } = useDevice();

  const cameras = createDeviceList(
    "videoinput",
    () => state.voice.preferredVideoDevice,
  );

  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [open, setOpen] = createSignal(false);
  // whether the menu was opened from the keyboard
  const [byKeyboard, setByKeyboard] = createSignal(false);

  const on = () => limits().video && voice.video();
  // some browsers list one camera only until permission is granted, so the
  // count taken when the camera turned on counts too
  const hasChoice = () =>
    limits().video && (cameras.devices().length > 1 || voice.cameraCount() > 1);
  const hasMenu = () => !isMobile && hasChoice();
  const label = () => t`Camera`;
  const buttonLabel = () =>
    limits().video
      ? voice.video()
        ? t`Stop camera`
        : t`Start camera`
      : t`Coming soon! 👀`;

  // close the menu when the choice disappears
  createEffect(() => {
    if (!hasMenu()) setOpen(false);
  });

  return (
    <>
      <SplitButton>
        <IconButton
          size={props.size}
          variant={on() ? "filled" : "tonal"}
          aria-label={buttonLabel()}
          onPress={() => {
            setOpen(false);
            if (limits().video) voice.toggleCamera();
          }}
          use:floating={{
            tooltip: { placement: "top", content: buttonLabel() },
          }}
          isDisabled={!limits().video}
        >
          <Symbol>camera_video</Symbol>
        </IconButton>

        <Show when={hasMenu()}>
          <DeviceChevronButton
            ref={setAnchor}
            type="button"
            variant={on() ? "filled" : "tonal"}
            size={props.size}
            aria-label={label()}
            aria-haspopup="menu"
            aria-expanded={open()}
            {...chevronMenuHandlers(open, setOpen, setByKeyboard)}
            use:floating={{
              tooltip: { placement: "top", content: label() },
            }}
          >
            <Symbol size={20}>expand_less</Symbol>
          </DeviceChevronButton>
          <AudioDeviceMenuPopup
            anchor={anchor()}
            open={open()}
            byKeyboard={byKeyboard()}
            label={label()}
            onClose={() => setOpen(false)}
          >
            <DeviceGroup
              label={label()}
              symbol="camera_video"
              devices={cameras.devices()}
              activeId={voice.activeVideoDeviceId() ?? cameras.activeId()}
              onPick={(id) => {
                voice.setVideoInput(id);
                setOpen(false);
              }}
            />
            <Show when={on()}>
              <ContextMenuButton
                aria-disabled={voice.flipping()}
                symbol={<Symbol size={16}>cameraswitch</Symbol>}
                onClick={() => {
                  setOpen(false);
                  voice.flipCamera();
                }}
              >
                {t`Flip camera`}
              </ContextMenuButton>
            </Show>
          </AudioDeviceMenuPopup>
        </Show>
      </SplitButton>

      <Show when={isMobile && on() && hasChoice()}>
        <IconButton
          size={props.size}
          variant="tonal"
          aria-label={t`Flip camera`}
          isDisabled={voice.flipping()}
          onPress={() => voice.flipCamera()}
          use:floating={{
            tooltip: { placement: "top", content: t`Flip camera` },
          }}
        >
          <Symbol>cameraswitch</Symbol>
        </IconButton>
      </Show>
    </>
  );
}
