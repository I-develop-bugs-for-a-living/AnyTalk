/**
 * The part of controller support that touches the page: finding focusable
 * elements, moving focus, and sending key events and clicks. The decisions
 * themselves live in `spatial.ts` and `navigation.ts`, which don't need a DOM.
 */
import { focusMessageList } from "@revolt/app/interface/channels/text/focusMessageList";
import { openContextMenuFor } from "@revolt/ui/directives";

import {
  type ActivationKind,
  type FocusContext,
  activationKind,
  isVerticallyScrollable,
  moveStrategy,
  neighbourIndex,
  stepDelta,
  stepIndex,
  stepNumber,
} from "./navigation";
import {
  type Candidate,
  type Direction,
  hasArea,
  isInViewport,
  nextRegion,
  pickBest,
  pickFirst,
} from "./spatial";

/** Elements focus can move to */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Overlays that capture focus while they are open: dialogs, the settings
 * screen and context menus. They all render into the #floating element.
 */
const LAYER_SELECTOR = [
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  ".dialog_scrim",
  ".settings_overlay",
].join(",");

/** The message box, which is a CodeMirror editor */
const COMPOSER_SELECTOR = ".cm-editor";

/** Regions the Start button cycles through, in order */
export const REGION_ORDER = ["servers", "channels", "messages", "members"];

/** The arrow key that stands for each direction */
const ARROW_KEYS: Record<Direction, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

/** An element with the newer visibility check, which older browsers lack */
interface WithVisibilityCheck {
  checkVisibility?: (options?: {
    checkVisibilityCSS?: boolean;
    visibilityProperty?: boolean;
  }) => boolean;
}

/** An element found by {@link collectCandidates}, with its position */
interface FocusTarget extends Candidate {
  element: HTMLElement;
}

/**
 * The focused element, or null when nothing (or only the page) has focus
 * @returns Element
 */
function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  if (
    !(active instanceof HTMLElement) ||
    active === document.body ||
    active === document.documentElement
  ) {
    return null;
  }
  return active;
}

/**
 * Describe an element for the decisions in `navigation.ts`
 * @param element Element, or null when nothing is focused
 * @returns Description
 */
function describeElement(element: HTMLElement | null): FocusContext {
  if (!element) {
    return {
      tag: "",
      isContentEditable: false,
      inContextMenu: false,
      isMessageItem: false,
    };
  }

  return {
    tag: element.tagName.toLowerCase(),
    inputType: element instanceof HTMLInputElement ? element.type : undefined,
    role: element.getAttribute("role") ?? undefined,
    isContentEditable: element.isContentEditable,
    inContextMenu: !!element.closest('[role="menu"]'),
    isMessageItem: element.hasAttribute("data-message-item"),
    orientation:
      element.closest("[aria-orientation]")?.getAttribute("aria-orientation") ??
      undefined,
  };
}

/**
 * Whether an element is shown and takes pointer input (a closed dialog's
 * scrim stays in the page without being visible)
 * @param element Element
 * @returns Boolean
 */
function isShown(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  return getComputedStyle(element).pointerEvents !== "none";
}

/**
 * The topmost open overlay (dialog, settings or context menu), if any
 * @returns Element
 */
export function topLayer(): HTMLElement | null {
  const root = document.getElementById("floating");
  if (!root) return null;

  const layers = Array.from(
    root.querySelectorAll<HTMLElement>(LAYER_SELECTOR),
  ).filter(isShown);

  return layers[layers.length - 1] ?? null;
}

/**
 * Region of the page an element sits in
 * @param element Element
 * @returns Region name, undefined for elements outside any region
 */
function regionOf(element: Element): string | undefined {
  const region = element.closest<HTMLElement>("[data-region]");
  if (region) return region.dataset.region;
  if (element.closest("main")) return "main";
  return undefined;
}

/**
 * Whether an element with tabindex="-1" is still a real control that should be
 * reachable: a button, link or field (they are taken out of the tab order by
 * the app's own focus handling) as opposed to a roving item such as a message
 * or a menu entry, which have their own keys. Buttons that the app takes out
 * of the tab order on purpose (the emoji picker's, the sidebars' icon buttons)
 * stay reachable here: a controller has no Tab key, so they are spatial stops.
 * @param element Element
 * @returns Boolean
 */
function isGenuineControl(element: HTMLElement): boolean {
  if (element.hasAttribute("data-message-item")) return false;
  if (
    element.closest(
      '[role="menu"],[role="listbox"],[role="tablist"],[role="radiogroup"]',
    )
  ) {
    return false;
  }
  const role = element.getAttribute("role");
  if (role === "menuitem" || role === "option" || role === "tab") return false;
  return element.matches('a[href],button,input:not([type="hidden"]),select');
}

/**
 * Whether an element can take focus right now
 * @param element Element
 * @returns Boolean
 */
function isFocusableNow(element: HTMLElement): boolean {
  if (element.matches(":disabled")) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.getAttribute("tabindex") === "-1" && !isGenuineControl(element)) {
    return false;
  }
  if (element.closest('[inert],[aria-hidden="true"],[hidden]')) return false;

  // links and buttons inside messages are left to the message's context menu,
  // otherwise the list would swallow every move; the message itself counts
  if (
    element.closest("[data-message-list]") &&
    !element.hasAttribute("data-message-item")
  ) {
    return false;
  }

  const check = (element as WithVisibilityCheck).checkVisibility;
  if (check && !check.call(element, { checkVisibilityCSS: true })) {
    return false;
  }

  return true;
}

/**
 * Find the focusable elements inside a root
 * @param root Overlay or document
 * @param exclude Element to leave out (the one focus starts from)
 * @returns Elements with their positions
 */
function collectCandidates(
  root: ParentNode,
  exclude?: Element | null,
): FocusTarget[] {
  const found: FocusTarget[] = [];

  for (const element of root.querySelectorAll<HTMLElement>(
    FOCUSABLE_SELECTOR,
  )) {
    if (element === exclude || !isFocusableNow(element)) continue;

    const rect = element.getBoundingClientRect();
    if (!hasArea(rect)) continue;
    // scrolled out sideways (e.g. a closed drawer), vertical overflow is
    // fine as focus scrolls it into view
    if (rect.right <= 0 || rect.left >= window.innerWidth) continue;

    found.push({ element, rect, region: regionOf(element) });
  }

  return found;
}

/**
 * Focus an element and bring it into view
 * @param element Element
 * @param fromOutsideMessages Whether focus is coming from outside the message list
 */
function focusElement(element: HTMLElement, fromOutsideMessages = false) {
  // entering the message list goes through its own helper, which picks the
  // message that is the list's tab stop and clears the pointer-focus state
  if (fromOutsideMessages && element.closest("[data-message-list]")) {
    if (focusMessageList()) return;
  }

  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * Focus something when nothing is focused: the message list of the main
 * region, else its first element, else the first element of the page
 * @param candidates Focusable elements to choose from
 */
function focusInitial(candidates: FocusTarget[]) {
  const main = candidates.filter((candidate) => candidate.region === "main");

  if (main.some((c) => c.element.closest("[data-message-list]"))) {
    if (focusMessageList()) return;
  }

  const pool = main.length ? main : candidates;
  const index = pickFirst(pool);
  if (index >= 0) focusElement(pool[index].element);
}

/**
 * Send a key press (down and up) to the focused element. The key reaches
 * handlers like a typed one does, including the keybinds on the body. The
 * release is always sent, otherwise the keybind handler would keep the key as
 * held.
 * @param key Key name, as in KeyboardEvent.key
 * @returns Whether a handler took the key (called preventDefault)
 */
export function dispatchKey(key: string): boolean {
  const target = document.activeElement ?? document.body;
  const init: KeyboardEventInit = {
    key,
    code: key === " " ? "Space" : key,
    bubbles: true,
    cancelable: true,
    composed: true,
  };

  const down = new KeyboardEvent("keydown", init);
  target.dispatchEvent(down);

  // the key may have closed what was focused, send the release somewhere
  // that still reaches the page
  const releaseTarget = target.isConnected ? target : document.body;
  releaseTarget.dispatchEvent(new KeyboardEvent("keyup", init));

  return down.defaultPrevented;
}

/**
 * Whether focus sits outside the open overlay, so keys must not act on it
 * @param layer Top overlay, null when none is open
 * @returns Boolean
 */
function focusOutsideLayer(layer: HTMLElement | null): boolean {
  const active = document.activeElement;
  return !!layer && !(active && layer.contains(active));
}

/**
 * Move focus into an overlay: its first menu item or focusable element
 * @param layer Overlay
 * @returns Whether something took focus
 */
function enterLayer(layer: HTMLElement): boolean {
  if (layer.matches('[role="menu"]')) {
    const item = layer.querySelector<HTMLElement>('[role="menuitem"]');
    (item ?? layer).focus({ preventScroll: true });
    return layer.contains(document.activeElement);
  }

  const candidates = collectCandidates(layer);
  const index = pickFirst(candidates);
  if (index >= 0) {
    focusElement(candidates[index].element);
    return true;
  }
  return false;
}

/** Frames to keep trying to move focus into an overlay that has nothing focusable yet */
const LAYER_ENTER_ATTEMPTS = 10;

/** Overlays focus was already moved into (or given up on), by what was focused before */
const enteredLayers = new Map<HTMLElement, Element | null>();

/** Failed attempts to enter an overlay */
const layerAttempts = new Map<HTMLElement, number>();

/** Whether the #floating element changed since the last check */
let layersDirty = true;

/** Watches #floating for overlays opening and closing */
let layerObserver: MutationObserver | null = null;

/**
 * Move focus into the top overlay when a new one opened (once, not again when
 * a nested one closes), and give focus back to where it was when an overlay
 * closes and focus got lost with it
 * @returns Whether it should be checked again (an overlay is still empty)
 */
function syncLayerFocus(): boolean {
  const layer = topLayer();

  // overlays that are gone: forget them, and restore focus if it was lost
  for (const [entered, previous] of [...enteredLayers]) {
    if (entered === layer || (entered.isConnected && isShown(entered))) {
      continue;
    }
    enteredLayers.delete(entered);
    layerAttempts.delete(entered);

    const lost = !focusedElement() || !document.activeElement?.isConnected;
    if (lost && previous instanceof HTMLElement && previous.isConnected) {
      previous.focus({ preventScroll: true });
    }
  }

  // overlays that closed while we were still trying to enter them
  for (const pending of [...layerAttempts.keys()]) {
    if (!pending.isConnected || !isShown(pending))
      layerAttempts.delete(pending);
  }

  if (!layer || enteredLayers.has(layer)) return false;

  if (!focusOutsideLayer(layer)) {
    enteredLayers.set(layer, null);
    return false;
  }

  const previous = document.activeElement;
  if (enterLayer(layer)) {
    enteredLayers.set(layer, previous);
    return false;
  }

  // nothing to focus yet (still rendering): try a few more times, then stop
  const attempts = (layerAttempts.get(layer) ?? 0) + 1;
  layerAttempts.set(layer, attempts);
  if (attempts >= LAYER_ENTER_ATTEMPTS) {
    enteredLayers.set(layer, previous);
    return false;
  }
  return true;
}

/**
 * Start watching for overlays opening and closing, so a controller moves focus
 * into dialogs. Costs nothing per frame unless #floating changed.
 * @returns Function to call on every frame, and one that stops watching
 */
export function watchLayers(): { tick: () => void; stop: () => void } {
  layersDirty = true;

  /** Start observing once #floating exists */
  const observe = () => {
    const root = document.getElementById("floating");
    if (!root || layerObserver) return;

    layerObserver = new MutationObserver(() => {
      layersDirty = true;
    });
    layerObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "open", "hidden", "aria-hidden"],
    });
    // anything already open when we start watching counts as a change
    layersDirty = true;
  };

  return {
    tick() {
      observe();
      if (!layersDirty) return;
      layersDirty = syncLayerFocus();
    },
    stop() {
      layerObserver?.disconnect();
      layerObserver = null;
      enteredLayers.clear();
      layerAttempts.clear();
    },
  };
}

/**
 * Move focus to the nearest element in a direction
 * @param direction Direction
 */
function moveSpatially(direction: Direction) {
  const layer = topLayer();
  const root: ParentNode = layer ?? document;
  const active = focusedElement();
  const from = active && (!layer || layer.contains(active)) ? active : null;

  const candidates = collectCandidates(root, from);

  if (!from) {
    focusInitial(candidates);
    return;
  }

  const index = pickBest(from.getBoundingClientRect(), candidates, direction, {
    currentRegion: regionOf(from),
  });
  if (index < 0) return;

  focusElement(candidates[index].element, !from.closest("[data-message-list]"));
}

/**
 * Change a select's value one option at a time
 * @param select Select element
 * @param direction left for the previous option, right for the next
 */
function stepSelect(select: HTMLSelectElement, direction: Direction) {
  const next = stepIndex(
    select.options.length,
    select.selectedIndex,
    direction === "left" ? -1 : 1,
  );
  if (next < 0 || next === select.selectedIndex) return;

  select.selectedIndex = next;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Change a slider, radio group or tab list by one step
 * @param element Focused widget
 * @param delta -1 for the previous or lower, 1 for the next or higher
 * @returns Whether anything changed
 */
function stepWidget(element: HTMLElement, delta: -1 | 0 | 1): boolean {
  if (delta === 0) return false;

  // sliders (native, or the mdui host which has the same properties)
  if (
    element.tagName === "MDUI-SLIDER" ||
    element instanceof HTMLInputElement
  ) {
    if (element instanceof HTMLInputElement && element.type === "radio") {
      return stepInGroup(element, radiosOf(element), delta);
    }

    const slider = element as HTMLElement & {
      value: number | string;
      min: number | string;
      max: number | string;
      step: number | string;
    };
    // a native range input without min/max reports "" (meaning 0 and 100)
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const step =
      slider.step === "any" ? (max - min) / 100 : Number(slider.step);
    const next = stepNumber(Number(slider.value), min, max, step, delta);
    if (next === undefined) return false;

    slider.value = next;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (element.tagName === "MDUI-RADIO") {
    const group = element.closest("mdui-radio-group");
    const radios = group
      ? Array.from(group.querySelectorAll<HTMLElement>("mdui-radio"))
      : [];
    return stepInGroup(element, radios, delta);
  }

  if (element.getAttribute("role") === "radio") {
    const group = element.closest('[role="radiogroup"]');
    const radios = group
      ? Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'))
      : [];
    return stepInGroup(element, radios, delta);
  }

  if (element.getAttribute("role") === "tab") {
    const list = element.closest('[role="tablist"]');
    const tabs = list
      ? Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
      : [];
    return stepInGroup(element, tabs, delta);
  }

  return false;
}

/**
 * The radio buttons that share a native radio's name
 * @param radio Native radio
 * @returns Radios, in page order
 */
function radiosOf(radio: HTMLInputElement): HTMLElement[] {
  if (!radio.name) return [radio];
  const root: ParentNode = radio.form ?? (radio.getRootNode() as ParentNode);
  return Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((other) => other.name === radio.name);
}

/**
 * Select and focus the neighbouring item of a radio group or tab list,
 * skipping disabled and hidden ones
 * @param element Current item
 * @param items All items of the group
 * @param delta -1 or 1
 * @returns Whether a neighbour was chosen
 */
function stepInGroup(
  element: HTMLElement,
  items: HTMLElement[],
  delta: -1 | 1,
): boolean {
  const usable = items.filter(
    (item) =>
      item === element ||
      (!item.matches(":disabled") &&
        item.getAttribute("aria-disabled") !== "true" &&
        !item.hasAttribute("disabled") &&
        item.getClientRects().length > 0),
  );
  const next =
    usable[neighbourIndex(usable.length, usable.indexOf(element), delta)];
  if (!next) return false;

  next.focus({ preventScroll: true });
  next.click();
  return true;
}

/**
 * Handle the D-pad or left stick: arrow keys where the focused element uses
 * them (menus, the message list, text fields), otherwise spatial navigation
 * @param direction Direction pressed
 */
export function moveFocus(direction: Direction) {
  const layer = topLayer();
  const active = focusedElement();

  // a context menu is open but focus is elsewhere (it was opened with the
  // mouse while typing): take focus into it so its keys work
  if (layer?.matches('[role="menu"]') && !layer.contains(active)) {
    enterLayer(layer);
    return;
  }

  // a dialog is open but focus stayed behind it: the keys must not reach
  // what's behind (the composer would move its caret), so pick a starting
  // point inside the dialog
  if (layer && focusOutsideLayer(layer)) {
    moveSpatially(direction);
    return;
  }

  switch (moveStrategy(describeElement(active), direction)) {
    case "keys":
      dispatchKey(ARROW_KEYS[direction]);
      return;

    case "step-widget":
      // at the end of the slider or group there is nothing to step: let focus
      // leave instead
      if (!stepWidget(active!, stepDelta(describeElement(active), direction))) {
        moveSpatially(direction);
      }
      return;

    case "message-list":
      // a message focused by a click isn't navigated by keys yet; focusing
      // through the list's helper makes it so
      if (!dispatchKey(ARROW_KEYS[direction]) && focusMessageList()) {
        dispatchKey(ARROW_KEYS[direction]);
      }
      return;

    case "keys-then-spatial":
      if (!dispatchKey(ARROW_KEYS[direction])) moveSpatially(direction);
      return;

    case "select-step":
      stepSelect(active as HTMLSelectElement, direction);
      return;

    case "spatial":
      moveSpatially(direction);
      return;
  }
}

/**
 * Handle A: activate the focused element
 */
export function activate() {
  // focus stayed behind an open overlay: take it in, but click nothing
  const layer = topLayer();
  if (layer && focusOutsideLayer(layer)) {
    enterLayer(layer);
    return;
  }

  const active = focusedElement();
  const kind: ActivationKind = activationKind(describeElement(active));

  switch (kind) {
    case "enter":
      dispatchKey("Enter");
      return;

    case "click":
      active?.click();
      return;

    case "picker": {
      const select = active as HTMLSelectElement & { showPicker?: () => void };
      try {
        select.showPicker?.();
      } catch {
        // showPicker refuses in some states, a click is the fallback
        select.click();
      }
      return;
    }

    case "none":
      // nothing to activate yet: pick a starting point instead
      moveSpatially("down");
      return;
  }
}

/**
 * Handle B: send Escape, which closes menus, dialogs and editing. If nothing
 * used it and focus is in the message box, leave the box for the messages.
 */
export function goBack() {
  const before = document.activeElement;
  const layerBefore = topLayer();

  // Escape keybinds don't call preventDefault, so a handled key can't be told
  // from an ignored one by the result. Any change to the page while the key is
  // processed (an overlay closing, an edit ending, an attachment removed)
  // means it was used.
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const handled = dispatchKey("Escape");
  const changed = observer.takeRecords().length > 0;
  observer.disconnect();

  if (handled || layerBefore || changed) return;

  const after = document.activeElement;
  if (
    after instanceof HTMLElement &&
    after === before &&
    after.isConnected &&
    after.closest(COMPOSER_SELECTOR)
  ) {
    after.blur();
    focusMessageList();
  }
}

/**
 * Handle X: open the context menu of the focused element. Not while an
 * overlay is open, as its menu would open behind or on top of it.
 */
export function openContextMenu() {
  if (topLayer()) return;
  openContextMenuFor(focusedElement());
}

/**
 * Handle the right stick: scroll the area around the focused element
 * @param amount Pixels to scroll, negative for up
 */
export function scrollPage(amount: number) {
  const layer = topLayer();
  const active = focusedElement();
  const origin = active && (!layer || layer.contains(active)) ? active : layer;

  /** Nearest ancestor (or the element itself) that scrolls vertically */
  const scrollParent = (start: Element | null): HTMLElement | null => {
    for (let el = start; el; el = el.parentElement) {
      if (!(el instanceof HTMLElement)) continue;
      if (
        isVerticallyScrollable(
          getComputedStyle(el).overflowY,
          el.scrollHeight,
          el.clientHeight,
        )
      ) {
        return el;
      }
    }
    return null;
  };

  let target = scrollParent(origin);

  // nothing around the focus scrolls (e.g. in the message box): use whatever
  // sits in the middle of the screen or the overlay
  if (!target) {
    const rect = (layer ?? document.documentElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = Math.min(rect.top + rect.height / 2, window.innerHeight / 2);
    target = scrollParent(document.elementFromPoint(x, y));
  }

  target?.scrollBy({ top: amount, behavior: "instant" });
}

/**
 * Region the focused element is in, as the Start button cycles through them
 * @returns Region name, or undefined when focus is somewhere else
 */
function currentCycleRegion(): string | undefined {
  const active = focusedElement();
  if (!active) return undefined;

  const region = regionOf(active);
  if (region && REGION_ORDER.includes(region)) return region;
  // the message box and the messages share the main region
  if (region === "main") return "messages";
  return undefined;
}

/**
 * Elements a region can give focus to right now
 * @param region Region name
 * @returns Elements, empty when the region isn't on screen
 */
function regionTargets(region: string): FocusTarget[] {
  if (region === "messages") {
    const item = document.querySelector<HTMLElement>(
      "[data-message-list] [data-message-item]",
    );
    if (!item) return [];
    return [{ element: item, rect: item.getBoundingClientRect() }];
  }

  const root = document.querySelector<HTMLElement>(`[data-region="${region}"]`);
  if (!root) return [];

  return collectCandidates(root).filter((candidate) =>
    isInViewport(candidate.rect, window.innerWidth, window.innerHeight),
  );
}

/**
 * Handle Start: move focus to the next region (servers, channels, messages,
 * members), skipping those that aren't on screen. Does nothing while an
 * overlay is open.
 */
export function cycleRegion() {
  if (topLayer()) return;

  const targets = new Map(
    REGION_ORDER.map((region) => [region, regionTargets(region)] as const),
  );
  const available = REGION_ORDER.filter(
    (region) => targets.get(region)!.length > 0,
  );

  const next = nextRegion(REGION_ORDER, currentCycleRegion(), available);
  if (!next) return;

  if (next === "messages") {
    focusMessageList();
    return;
  }

  // start on the entry that is current (the open server or channel), else the
  // first one
  const candidates = targets.get(next)!;
  const current = candidates.find((candidate) =>
    candidate.element.matches('[aria-current]:not([aria-current="false"])'),
  );
  const index = pickFirst(candidates);
  const element = current?.element ?? candidates[index]?.element;
  if (element) focusElement(element);
}

/**
 * Mark the page as used with a controller (or not), which turns on focus
 * rings for programmatic focus (see styles.css)
 * @param on Whether a controller is in use
 */
export function setGamepadInputMode(on: boolean) {
  if (on) document.documentElement.dataset.input = "gamepad";
  else delete document.documentElement.dataset.input;
}
