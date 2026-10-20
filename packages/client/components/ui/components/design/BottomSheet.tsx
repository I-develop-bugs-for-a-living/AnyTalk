import { JSX, Show, createEffect, on, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Motion, Presence } from "solid-motionone";

import { useLingui } from "@lingui/solid/macro";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { Symbol } from "../utils/Symbol";
import { IconButton } from "./IconButton";
import { Text } from "./Text";

interface Props {
  /**
   * Whether the sheet is open
   */
  show: boolean;

  /**
   * Called when the user taps the scrim, presses Escape or the close button
   */
  onClose: () => void;

  /**
   * Title in the header, also the accessible name of the sheet
   */
  title: string;

  /**
   * Element ID, for `aria-controls` on the control that opens the sheet
   */
  id?: string;

  children: JSX.Element;
}

/**
 * Selector for elements that can take keyboard focus
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet for phones: slides up from the bottom edge over a scrim.
 * Respects the home indicator and uses the visible viewport height.
 *
 * While open it traps Tab inside the sheet, locks scrolling of the page and
 * moves focus into the sheet. On close, focus goes back to the element that
 * had it before, but only if focus was still inside the sheet or the sheet
 * was closed with Escape. If the user tapped something else (for example a
 * link that navigates), focus is left alone.
 *
 * @specification https://m3.material.io/components/bottom-sheets
 */
export function BottomSheet(props: Props) {
  const { t } = useLingui();
  let sheet: HTMLDivElement | undefined;

  const reduceMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  createEffect(
    on(
      () => props.show,
      (show) => {
        if (!show) return;

        const previous = document.activeElement as HTMLElement | null;
        let escaped = false;

        // Escape closes, Tab stays inside the sheet
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            escaped = true;
            props.onClose();
          } else if (event.key === "Tab" && sheet) {
            const items = Array.from(
              sheet.querySelectorAll<HTMLElement>(FOCUSABLE),
            );
            if (!items.length) {
              event.preventDefault();
              sheet.focus();
              return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || active === sheet)) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && active === last) {
              event.preventDefault();
              first.focus();
            }
          }
        };
        document.addEventListener("keydown", onKeyDown);

        // lock page scroll behind the sheet
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        onCleanup(() => {
          document.removeEventListener("keydown", onKeyDown);
          document.body.style.overflow = previousOverflow;
          if (escaped || sheet?.contains(document.activeElement)) {
            previous?.focus();
          }
        });
      },
    ),
  );

  return (
    <Portal mount={document.getElementById("floating")!}>
      <Presence>
        <Show when={props.show}>
          <Motion.div
            class={scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion() ? 0 : 0.2 }}
            onClick={() => props.onClose()}
          />
        </Show>
      </Presence>
      <Presence>
        <Show when={props.show}>
          <Motion.div
            id={props.id}
            class={sheetStyle}
            ref={(el: HTMLDivElement) => {
              sheet = el;
              // wait for the element to be in the page before focusing it
              requestAnimationFrame(() => el.focus());
            }}
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
            tabIndex={-1}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{
              duration: reduceMotion() ? 0 : 0.3,
              easing: [0.05, 0.7, 0.1, 1.0],
            }}
          >
            <Handle aria-hidden="true" />
            <Header>
              <Text class="title" size="medium">
                {props.title}
              </Text>
              <IconButton
                variant="standard"
                size="md"
                aria-label={t`Close`}
                onPress={() => props.onClose()}
              >
                <Symbol>close</Symbol>
              </IconButton>
            </Header>
            {props.children}
          </Motion.div>
        </Show>
      </Presence>
    </Portal>
  );
}

/**
 * Title and close button
 */
const Header = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
    paddingInline: "16px 4px",
  },
});

/**
 * Dimmed background behind the sheet
 */
const scrim = css({
  position: "fixed",
  inset: 0,
  zIndex: 998,
  background:
    "color-mix(in srgb, var(--md-sys-color-scrim, black) 40%, transparent)",
});

/**
 * The sheet surface
 */
const sheetStyle = css({
  position: "fixed",
  insetInline: 0,
  insetBlockEnd: 0,
  zIndex: 999,
  display: "flex",
  flexDirection: "column",
  maxHeight: "85dvh",
  paddingBlockEnd: "env(safe-area-inset-bottom)",
  borderStartStartRadius: "var(--borderRadius-xl)",
  borderStartEndRadius: "var(--borderRadius-xl)",
  background: "var(--md-sys-color-surface-container-low)",
  color: "var(--md-sys-color-on-surface)",
  boxShadow: "0 0 8px var(--md-sys-color-shadow)",
  outline: "none",
  overflow: "hidden",
});

/**
 * Decorative drag handle at the top of the sheet
 */
const Handle = styled("div", {
  base: {
    flexShrink: 0,
    width: "32px",
    height: "4px",
    marginBlock: "12px 4px",
    marginInline: "auto",
    borderRadius: "var(--borderRadius-full)",
    background: "var(--md-sys-color-outline)",
  },
});
