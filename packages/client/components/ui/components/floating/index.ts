export { FloatingManager } from "./FloatingManager";
export { Tooltip } from "./Tooltip";
export { UserCard } from "./UserCard";

/**
 * Trigger a global pointerdown running the floating close logic. It is sent
 * from `body` (bubbling up to `document`): long-press-event walks up from the
 * event target looking for attributes and throws on `document`, which has no
 * `getAttribute`.
 */
export function dismissFloatingElements() {
  document.body.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true }),
  );
}
