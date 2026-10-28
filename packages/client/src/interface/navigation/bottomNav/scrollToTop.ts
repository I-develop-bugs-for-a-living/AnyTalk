/**
 * Scroll the lists inside an element back to the top, as a tap on the active
 * tab of the bottom bar does. Only elements that are scrolled and can scroll
 * vertically are touched, so it works for any list without markers.
 * @param root Element holding the tab's screen
 */
export function scrollListsToTop(root: HTMLElement | undefined) {
  if (!root) return;

  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    // cheap check first, the computed style is only read for scrolled elements
    if (element.scrollTop <= 0) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow === "auto" || overflow === "scroll") {
      element.scrollTo({ top: 0, behavior });
    }
  }
}
