import { useFloating } from "solid-floating-ui";
import { Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Motion, Presence } from "solid-motionone";
import { styled } from "styled-system/jsx";

import { autoUpdate, flip, offset, shift } from "@floating-ui/dom";
import { useLingui } from "@lingui/solid/macro";

import { ContextMenu, ContextMenuButton } from "@revolt/app/menus/ContextMenu";
import { useInstance } from "@revolt/instance";
import { useVoice } from "@revolt/rtc";
import { SCREEN_SHARE_RESOLUTION_LABELS } from "@revolt/rtc/state";
import { IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";
import { floatingElements } from "@revolt/ui/directives";

/** How long the menu stays open after the pointer leaves it */
const CLOSE_DELAY_MS = 200;

/**
 * Start or stop sharing the screen. While streaming, hovering it offers to
 * switch window or change the stream's quality without restarting it, so
 * viewers keep watching.
 */
export function ScreenShareButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const { t } = useLingui();
  const { limits } = useInstance();

  const [anchor, setAnchor] = createSignal<HTMLDivElement>();
  const [menu, setMenu] = createSignal<HTMLDivElement>();
  const [open, setOpen] = createSignal(false);

  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(closeTimer));

  const position = useFloating(anchor, menu, {
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  function show() {
    clearTimeout(closeTimer);
    if (!voice.streamOptions()) return;

    setOpen(true);

    // the menu takes the place of the button's tooltip; it is shown by the
    // same pointer event, so hide it once that is handled
    setTimeout(() =>
      floatingElements()
        .find((el) => anchor()?.contains(el.element))
        ?.hide(),
    );
  }

  function hide() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  function pick(action: () => void) {
    clearTimeout(closeTimer);
    setOpen(false);
    action();
  }

  const quality = () => {
    const options = voice.streamOptions();
    return options
      ? `${SCREEN_SHARE_RESOLUTION_LABELS[options.resolution]} · ${options.frameRate} FPS`
      : "";
  };

  return (
    <div ref={setAnchor} onMouseEnter={show} onMouseLeave={hide}>
      <IconButton
        size={props.size}
        variant={limits().video && voice.screenshare() ? "filled" : "tonal"}
        onPress={() => {
          setOpen(false);
          if (limits().video) voice.toggleScreenshare();
        }}
        use:floating={{
          tooltip: {
            placement: "top",
            content: limits().video
              ? voice.screenshare()
                ? t`Stop sharing`
                : t`Share screen`
              : t`Coming soon! 👀`,
          },
        }}
        isDisabled={!limits().video}
      >
        <Show
          when={!limits().video || voice.screenshare()}
          fallback={<Symbol>stop_screen_share</Symbol>}
        >
          <Symbol>screen_share</Symbol>
        </Show>
      </IconButton>

      <Portal mount={document.getElementById("floating")!}>
        <Presence>
          <Show when={open() && voice.streamOptions()}>
            <Motion
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1, easing: [0.87, 0, 0.13, 1] }}
            >
              <div
                ref={setMenu}
                onMouseEnter={show}
                onMouseLeave={hide}
                style={{
                  position: position.strategy,
                  top: `${position.y ?? 0}px`,
                  left: `${position.x ?? 0}px`,
                  "z-index": "999",
                }}
              >
                <ContextMenu>
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
                  <ContextMenuButton
                    symbol={<Symbol size={16}>stop_screen_share</Symbol>}
                    destructive
                    onClick={() => pick(() => voice.toggleScreenshare())}
                  >
                    {t`Stop sharing`}
                  </ContextMenuButton>
                </ContextMenu>
              </div>
            </Motion>
          </Show>
        </Presence>
      </Portal>
    </div>
  );
}

const Quality = styled("span", {
  base: {
    marginInlineStart: "var(--gap-lg)",
    opacity: 0.7,
    whiteSpace: "nowrap",
    textTransform: "none",
  },
});
