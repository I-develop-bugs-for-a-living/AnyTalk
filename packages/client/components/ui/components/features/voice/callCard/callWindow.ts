import { createSignal } from "solid-js";

import Breakpoint from "@revolt/common/Breakpoint";

const phoneQuery = window.matchMedia(Breakpoint.phone);
const [phone, setPhone] = createSignal(phoneQuery.matches);
phoneQuery.addEventListener("change", () => setPhone(phoneQuery.matches));

/**
 * Whether the viewport has the phone layout (reactive)
 */
export const isPhoneWidth = phone;

const [hidden, setHidden] = createSignal(false);

/**
 * Whether the user hid the floating call window for the current call
 * (phones only, in memory only)
 */
export const callWindowHidden = hidden;

/**
 * Hide or show the floating call window; the call itself keeps running.
 * It is reset when the call ends or another call starts.
 * @param value Whether to hide it
 */
export const setCallWindowHidden = setHidden;

/**
 * Whether the floating call window is hidden right now (hidden on a phone)
 */
export const callWindowHiddenOnPhone = () => phone() && hidden();

/**
 * Hide the floating call window and move focus to the open bottom bar tab,
 * so keyboard and screen reader users don't lose their place
 */
export function hideCallWindow() {
  setHidden(true);
  const tab = document.querySelector<HTMLElement>(
    '[data-bottom-nav] [aria-current="true"]',
  );
  if (tab) tab.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
}

/**
 * Bring the floating call window back and focus its hide button
 */
export function showCallWindow() {
  setHidden(false);
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>("[data-hide-call-window]")
      ?.focus({ preventScroll: true }),
  );
}
