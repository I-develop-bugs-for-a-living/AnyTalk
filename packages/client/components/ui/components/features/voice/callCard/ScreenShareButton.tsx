import { Show, createEffect, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { ContextMenuButton } from "@revolt/app/menus/ContextMenu";
import { useInstance } from "@revolt/instance";
import { useVoice } from "@revolt/rtc";
import { SCREEN_SHARE_RESOLUTION_LABELS } from "@revolt/rtc/state";
import { IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  DeviceChevronButton,
  SplitButton,
  chevronMenuHandlers,
} from "./AudioDeviceChevron";
import { AudioDeviceMenuPopup } from "./AudioDeviceMenu";

/**
 * Start or stop sharing the screen. While streaming, the button turns red
 * and a chevron (the same split button as the mute and deafen device
 * chevrons) opens a menu to switch window or change the stream's quality
 * without restarting it, so viewers keep watching.
 */
export function ScreenShareButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const { t } = useLingui();
  const { limits } = useInstance();

  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [open, setOpen] = createSignal(false);
  // whether the menu was opened from the keyboard
  const [byKeyboard, setByKeyboard] = createSignal(false);

  /** Whether a stream is running (the menu only applies then) */
  const streaming = () => limits().video && !!voice.screenshare();
  const hasMenu = () => streaming() && !!voice.streamOptions();
  const label = () => t`Stream options`;
  /** Label and tooltip of the main button, following what a press does */
  const buttonLabel = () =>
    limits().video
      ? streaming()
        ? t`Stop sharing`
        : t`Share screen`
      : t`Coming soon! 👀`;

  // close the menu when the stream ends
  createEffect(() => {
    if (!hasMenu()) setOpen(false);
  });

  /** Current resolution and frame rate, shown next to the settings item */
  const quality = () => {
    const options = voice.streamOptions();
    return options
      ? `${SCREEN_SHARE_RESOLUTION_LABELS[options.resolution]} · ${options.frameRate} FPS`
      : "";
  };

  /**
   * Close the menu and run the chosen action
   * @param action Action to run
   */
  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <SplitButton>
      <IconButton
        size={props.size}
        variant={streaming() ? "error" : "tonal"}
        aria-label={buttonLabel()}
        onPress={() => {
          setOpen(false);
          if (limits().video) voice.toggleScreenshare();
        }}
        use:floating={{
          tooltip: {
            placement: "top",
            content: buttonLabel(),
          },
        }}
        isDisabled={!limits().video}
      >
        <Show when={streaming()} fallback={<Symbol>screen_share</Symbol>}>
          <Symbol>stop_screen_share</Symbol>
        </Show>
      </IconButton>

      <Show when={hasMenu()}>
        <DeviceChevronButton
          ref={setAnchor}
          type="button"
          variant="error"
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
          <ContextMenuButton
            symbol={<Symbol size={16}>swap_horiz</Symbol>}
            onClick={() => pick(() => voice.switchScreenshareSource())}
          >
            {t`Switch window`}
          </ContextMenuButton>
          <ContextMenuButton
            symbol={<Symbol size={16}>tune</Symbol>}
            actionSymbol={<Quality>{quality()}</Quality>}
            onClick={() => pick(() => voice.openScreenshareSettings())}
          >
            {t`Resolution and FPS`}
          </ContextMenuButton>
        </AudioDeviceMenuPopup>
      </Show>
    </SplitButton>
  );
}

/** Current quality, shown at the end of the settings item */
const Quality = styled("span", {
  base: {
    marginInlineStart: "var(--gap-lg)",
    opacity: 0.7,
    whiteSpace: "nowrap",
    textTransform: "none",
  },
});
