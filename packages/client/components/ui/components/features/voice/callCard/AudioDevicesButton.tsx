import { useFloating } from "solid-floating-ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useMediaDeviceSelect } from "solid-livekit-components";
import { Motion, Presence } from "solid-motionone";

import { autoUpdate, flip, offset, shift } from "@floating-ui/dom";
import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { ContextMenu, ContextMenuButton } from "@revolt/app/menus/ContextMenu";
import { stoatSinkName, useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * The audio devices (inputs or outputs) to offer: without the virtual
 * device, the system default first.
 * @param devices Devices as listed by the browser
 * @returns Devices to offer
 */
export function listAudioDevices(devices: MediaDeviceInfo[]) {
  const real = devices.filter(
    (dev) => dev.label.split(":").pop() !== stoatSinkName,
  );
  const fallback = real.find((d) => d.deviceId === "default");
  return [
    ...(fallback ? [fallback] : []),
    ...real.filter((d) => d.deviceId !== "default"),
  ];
}

/**
 * The device list of one kind, following devices being plugged in and out,
 * and which one is active
 * @param kind Device kind
 * @param preferred Preferred device ID, if any
 */
function createDeviceList(
  kind: "audioinput" | "audiooutput",
  preferred: () => string | undefined,
) {
  const media = createMemo(() => useMediaDeviceSelect({ kind }));
  const devices = createMemo(() => listAudioDevices(media().devices()));

  // the preferred device, or the default when none is chosen (or it is gone)
  const activeId = createMemo(() => {
    const wanted = preferred();
    return wanted && devices().some((d) => d.deviceId === wanted)
      ? wanted
      : (devices().find((d) => d.deviceId === "default")?.deviceId ??
          devices()[0]?.deviceId);
  });

  return { devices, activeId };
}

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
  const [menu, setMenu] = createSignal<HTMLDivElement>();
  const [open, setOpen] = createSignal(false);
  // whether the menu was opened from the keyboard
  const [byKeyboard, setByKeyboard] = createSignal(false);

  const position = useFloating(anchor, menu, {
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  // close when pressing outside of the button and menu
  createEffect(() => {
    if (!open()) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu()?.contains(target) && !anchor()?.contains(target)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    onCleanup(() =>
      window.removeEventListener("pointerdown", onPointerDown, true),
    );
  });

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

        <Portal mount={document.getElementById("floating")!}>
          <Presence>
            <Show when={open()}>
              <Motion
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1, easing: [0.87, 0, 0.13, 1] }}
              >
                <div
                  ref={setMenu}
                  style={{
                    position: position.strategy,
                    top: `${position.y ?? 0}px`,
                    left: `${position.x ?? 0}px`,
                    "z-index": "999",
                  }}
                >
                  <ContextMenu
                    aria-label={t`Audio devices`}
                    initialFocus={byKeyboard() ? "first" : "container"}
                    onRequestClose={() => setOpen(false)}
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
                  </ContextMenu>
                </div>
              </Motion>
            </Show>
          </Presence>
        </Portal>
      </div>
    </Show>
  );
}

/**
 * One labelled list of devices with a check on the active one
 */
function DeviceGroup(props: {
  label: string;
  symbol: string;
  devices: MediaDeviceInfo[];
  activeId?: string;
  onPick: (deviceId: string) => void;
}) {
  const { t } = useLingui();

  return (
    <Show when={props.devices.length}>
      <div role="group" aria-label={props.label}>
        <GroupLabel aria-hidden="true">{props.label}</GroupLabel>
        <For each={props.devices}>
          {(device) => (
            <ContextMenuButton
              symbol={<Symbol size={16}>{props.symbol}</Symbol>}
              actionSymbol={
                <Show when={device.deviceId === props.activeId}>
                  <Symbol size={20}>check</Symbol>
                </Show>
              }
              aria-current={
                device.deviceId === props.activeId ? "true" : undefined
              }
              onClick={() => props.onPick(device.deviceId)}
            >
              {device.label || t`Default`}
            </ContextMenuButton>
          )}
        </For>
      </div>
    </Show>
  );
}

const GroupLabel = styled("div", {
  base: {
    paddingBlock: "var(--gap-sm)",
    paddingInline: "var(--gap-lg)",
    fontSize: "0.75rem",
    fontWeight: 600,
    opacity: 0.7,
    textTransform: "uppercase",
  },
});
