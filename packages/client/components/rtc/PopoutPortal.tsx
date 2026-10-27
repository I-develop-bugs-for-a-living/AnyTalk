import { type JSX, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

/**
 * Renders its children into the body of another window (a popout) through a
 * portal, so the app's contexts still reach them. Calls `onClose` when the
 * window is closed or navigated away.
 *
 * Solid's delegated events (`onClick`) only listen on the app's own document
 * and never fire in another window: children must use native listeners
 * (`on:click`).
 */
export function PopoutPortal(props: {
  win: Window;
  onClose: () => void;
  children: JSX.Element;
}) {
  onMount(() => {
    const win = props.win;
    const onGone = () => props.onClose();
    win.addEventListener("pagehide", onGone);
    // a popup can't always tell that it was closed, so look for it too
    const poll = setInterval(() => win.closed && onGone(), 500);
    onCleanup(() => {
      win.removeEventListener("pagehide", onGone);
      clearInterval(poll);
    });
  });

  return (
    <Portal
      mount={props.win.document.body}
      ref={(el) => {
        el.style.width = "100%";
        el.style.height = "100%";
      }}
    >
      {props.children}
    </Portal>
  );
}
