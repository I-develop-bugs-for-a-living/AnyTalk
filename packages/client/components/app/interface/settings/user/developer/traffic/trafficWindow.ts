import { createSignal } from "solid-js";

import {
  INSPECTOR_FRAME_PREFIX,
  openPopoutWindow,
  pickPopoutApi,
} from "@revolt/rtc/streamPopout";

/** The open inspector window and how to let go of it. */
type OpenWindow = { win: Window; stopFollowing: () => void };

/** True while a window is being opened, so a double click opens only one. */
let opening = false;

/** The inspector's window while it is open. */
const [openWindow, setOpenWindow] = createSignal<OpenWindow>();

/**
 * The window the live view is shown in while it is open (reactive).
 */
export function trafficWindow(): Window | undefined {
  return openWindow()?.win;
}

/**
 * Whether the live view can be opened as a window here: not on touch-only
 * devices and not without a popout API (reactive-free, checks the device).
 */
export function canOpenTrafficWindow(): boolean {
  return (
    pickPopoutApi(
      window,
      // touch-only means no mouse or trackpad at all
      !matchMedia("(any-pointer: fine)").matches,
      typeof window.open === "function",
      !!window.native,
    ) !== undefined
  );
}

/**
 * Open the live view in a window of its own, or bring the open one to the
 * front. Call it straight from a click, with nothing awaited before: the
 * browser blocks pop-ups that are opened later.
 *
 * @param title Title of the window
 * @returns Whether the window is open now, or undefined when another call is
 * still opening it (nothing to report)
 */
export async function openTrafficWindow(
  title: string,
): Promise<boolean | undefined> {
  if (opening) return undefined;
  const current = openWindow();
  if (current && !current.win.closed) {
    try {
      current.win.focus();
    } catch {
      // not allowed to focus
    }
    return true;
  }
  // the old window is dead: let go of its style observers
  current?.stopFollowing();

  const kind = pickPopoutApi(
    window,
    !matchMedia("(any-pointer: fine)").matches,
    typeof window.open === "function",
    !!window.native,
  );
  if (!kind) return false;

  opening = true;
  try {
    const opened = await openPopoutWindow(kind, {
      title,
      width: 1100,
      height: 700,
      name: "live",
      framePrefix: INSPECTOR_FRAME_PREFIX,
      background: "var(--md-sys-color-surface)",
      scroll: false,
    });
    setOpenWindow(opened);
    return true;
  } catch (e) {
    console.debug("[traffic] could not open the inspector window", e);
    return false;
  } finally {
    opening = false;
  }
}

/**
 * Close the inspector window, if open. Safe to call when it was already
 * closed from its own side.
 */
export function closeTrafficWindow() {
  const current = openWindow();
  if (!current) return;
  setOpenWindow(undefined);
  current.stopFollowing();
  try {
    current.win.close();
  } catch {
    // already gone
  }
}
