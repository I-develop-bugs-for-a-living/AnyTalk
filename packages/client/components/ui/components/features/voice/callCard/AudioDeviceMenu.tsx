import { useFloating } from "solid-floating-ui";
import {
  Accessor,
  For,
  JSX,
  Show,
  createEffect,
  createMemo,
  createRoot,
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
import { stoatSinkName } from "@revolt/rtc";
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

/** Device lists shared by everything that offers devices, one per kind */
const sharedLists = new Map<string, Accessor<MediaDeviceInfo[]>>();

/**
 * The one device list of a kind, created on first use and kept for the life
 * of the app. useMediaDeviceSelect never releases its devicechange
 * subscription, so every instance would leak; sharing one avoids that. It
 * doesn't ask for permission (labels are available once in a call).
 * @param kind Device kind
 * @returns Devices as offered by the app, following plug and unplug
 */
function sharedDeviceList(kind: "audioinput" | "audiooutput") {
  let list = sharedLists.get(kind);
  if (!list) {
    list = createRoot(() => {
      const select = useMediaDeviceSelect({
        kind,
        requestPermissions: false,
      });
      const devices = createMemo(() => listAudioDevices(select.devices()));
      return devices;
    });
    sharedLists.set(kind, list);
  }
  return list;
}

/**
 * The device list of one kind, following devices being plugged in and out,
 * and which one is active
 * @param kind Device kind
 * @param preferred Preferred device ID, if any
 */
export function createDeviceList(
  kind: "audioinput" | "audiooutput",
  preferred: () => string | undefined,
) {
  const devices = sharedDeviceList(kind);

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
 * Floating menu of audio devices above an anchor element: positioned with
 * floating-ui (flips and shifts to stay on screen), closes on a press
 * outside and gives focus to the first item when opened by keyboard. Shared
 * by the call card's device button and the footer's split buttons.
 */
export function AudioDeviceMenuPopup(props: {
  anchor: HTMLElement | undefined;
  open: boolean;
  byKeyboard: boolean;
  label: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  const [menu, setMenu] = createSignal<HTMLDivElement>();

  const position = useFloating(() => props.anchor, menu, {
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  // close when pressing outside of the anchor and menu
  createEffect(() => {
    if (!props.open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu()?.contains(target) && !props.anchor?.contains(target)) {
        props.onClose();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    onCleanup(() =>
      window.removeEventListener("pointerdown", onPointerDown, true),
    );
  });

  return (
    <Portal mount={document.getElementById("floating")!}>
      <Presence>
        <Show when={props.open}>
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
                aria-label={props.label}
                initialFocus={props.byKeyboard ? "first" : "container"}
                onRequestClose={props.onClose}
              >
                {props.children}
              </ContextMenu>
            </div>
          </Motion>
        </Show>
      </Presence>
    </Portal>
  );
}

/**
 * One labelled list of devices with a check on the active one
 */
export function DeviceGroup(props: {
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

/** Small heading above a group of devices in the menu */
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
