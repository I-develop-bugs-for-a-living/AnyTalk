/**
 * Decisions about how a controller press acts on the focused element. They
 * take a plain description of that element (see `describeElement` in dom.ts)
 * so they can be tested without a DOM.
 */
import type { Direction } from "./spatial";

/** What the focused element is, as far as controller navigation cares */
export interface FocusContext {
  /** Lower case tag name, empty when nothing is focused */
  tag: string;
  /** `type` of an input element */
  inputType?: string;
  /** Value of the `role` attribute */
  role?: string;
  /** Whether the element takes typed text (contenteditable) */
  isContentEditable: boolean;
  /** Whether the element is inside an open context menu */
  inContextMenu: boolean;
  /** Whether the element is a message in the message list */
  isMessageItem: boolean;
  /** `aria-orientation` of the element or its slider, tablist or radiogroup */
  orientation?: string;
}

/** Input types that don't take typed text: pressing them clicks */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether the element takes typed text
 * @param context Focused element
 * @returns Boolean
 */
export function isTextField(context: FocusContext): boolean {
  if (context.isContentEditable || context.tag === "textarea") return true;
  // the host of an mdui text field (the real input sits in its shadow root)
  if (context.tag === "mdui-text-field") return true;
  return (
    context.tag === "input" &&
    !NON_TEXT_INPUT_TYPES.has(context.inputType ?? "text")
  );
}

/** Widgets whose value or selection is changed with left and right */
export type StepWidget = "slider" | "radio" | "tab";

/**
 * Which stepped widget the focused element is. Synthetic arrow keys don't
 * change these (browsers ignore untrusted keys on native controls, and mdui
 * components keep the real control in a shadow root), so the value is
 * changed directly (see `stepWidget` in dom.ts).
 * @param context Focused element
 * @returns Widget kind, undefined for anything else
 */
export function steppedWidget(context: FocusContext): StepWidget | undefined {
  if (context.tag === "mdui-slider") return "slider";
  if (context.tag === "input" && context.inputType === "range") return "slider";
  if (context.tag === "mdui-radio" || context.role === "radio") return "radio";
  if (context.tag === "input" && context.inputType === "radio") return "radio";
  if (context.role === "tab") return "tab";
  return undefined;
}

/**
 * Which way a direction press moves a stepped widget
 * - sliders: left lowers and right raises (vertical ones: down lowers, up
 *   raises)
 * - radio buttons and tabs: left or up go to the previous one, right or down
 *   to the next, along the widget's axis (horizontal unless `aria-orientation`
 *   says vertical)
 * Directions across the axis return 0, which means navigate spatially.
 * @param context Focused element
 * @param direction Pressed direction
 * @returns -1, 1, or 0 when the press doesn't step the widget
 */
export function stepDelta(
  context: FocusContext,
  direction: Direction,
): -1 | 0 | 1 {
  const widget = steppedWidget(context);
  if (!widget) return 0;

  const vertical = direction === "up" || direction === "down";
  const verticalWidget = context.orientation === "vertical";
  if (vertical !== verticalWidget) return 0;

  if (widget === "slider" && vertical) return direction === "up" ? 1 : -1;
  return direction === "left" || direction === "up" ? -1 : 1;
}

/**
 * Move a number one step, kept inside its range
 * @param value Current value
 * @param min Lowest value
 * @param max Highest value
 * @param step Step size (a missing or invalid one counts as 1)
 * @param delta -1 or 1
 * @returns The new value, undefined when already at the end of the range
 */
export function stepNumber(
  value: number,
  min: number,
  max: number,
  step: number,
  delta: -1 | 1,
): number | undefined {
  const size = Number.isFinite(step) && step > 0 ? step : 1;
  const current = Number.isFinite(value) ? value : min;
  // toFixed keeps 0.1 + 0.2 style errors out of the value
  const next = Number((current + delta * size).toFixed(10));
  const clamped = Math.max(min, Math.min(max, next));
  return clamped === current ? undefined : clamped;
}

/**
 * Index of the neighbour in a group, without wrapping
 * @param length Number of items
 * @param current Index of the current item
 * @param delta -1 or 1
 * @returns The neighbour's index, -1 when there is none
 */
export function neighbourIndex(
  length: number,
  current: number,
  delta: -1 | 1,
): number {
  const next = current + delta;
  return current < 0 || next < 0 || next >= length ? -1 : next;
}

/**
 * How a direction press is carried out
 * - `keys`: send arrow key events and stop (context menus handle their own
 *   keys, and leaving them by moving focus would break them)
 * - `message-list`: send arrow key events to the message list, which moves
 *   between messages
 * - `keys-then-spatial`: send arrow key events (an editor may use them, e.g.
 *   for autocomplete) and move focus spatially if nothing used them
 * - `select-step`: change the value of a select with left and right
 * - `step-widget`: change a slider, radio group or tab list directly; when it
 *   is at the end, navigate spatially so focus can always leave
 * - `spatial`: move focus to the nearest element in that direction
 */
export type MoveStrategy =
  | "keys"
  | "message-list"
  | "keys-then-spatial"
  | "select-step"
  | "step-widget"
  | "spatial";

/**
 * Decide how to carry out a direction press
 * @param context Focused element
 * @param direction Pressed direction
 * @returns Strategy
 */
export function moveStrategy(
  context: FocusContext,
  direction: Direction,
): MoveStrategy {
  const vertical = direction === "up" || direction === "down";

  if (context.inContextMenu) return "keys";
  if (stepDelta(context, direction) !== 0) return "step-widget";
  if (context.isMessageItem && vertical) return "message-list";
  if (context.tag === "select" && !vertical) return "select-step";
  if (isTextField(context)) return "keys-then-spatial";
  return "spatial";
}

/**
 * How the A button activates the focused element
 * - `enter`: send an Enter key event (text fields and messages react to it)
 * - `click`: click the element (buttons, links, checkboxes, menu items)
 * - `picker`: open a select's list of options
 * - `none`: nothing to activate
 */
export type ActivationKind = "enter" | "click" | "picker" | "none";

/**
 * Decide how to activate the focused element
 * @param context Focused element
 * @returns Activation kind
 */
export function activationKind(context: FocusContext): ActivationKind {
  if (!context.tag || context.tag === "body" || context.tag === "html") {
    return "none";
  }
  // the menu itself has focus, no item is chosen yet
  if (context.role === "menu") return "none";
  if (context.tag === "select") return "picker";
  if (context.isMessageItem) return "enter";
  if (context.inContextMenu) return "click";
  if (isTextField(context)) return "enter";
  return "click";
}

/**
 * Next index when stepping through a list without wrapping
 * @param length Number of options
 * @param current Current index
 * @param step -1 for the previous, 1 for the next
 * @returns New index, or the same one when at the end
 */
export function stepIndex(
  length: number,
  current: number,
  step: -1 | 1,
): number {
  if (length <= 0) return -1;
  if (current < 0) return step === 1 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + step));
}

/**
 * Whether an element can be scrolled vertically
 * @param overflowY Computed `overflow-y`
 * @param scrollHeight Height of the content
 * @param clientHeight Height of the visible area
 * @returns Boolean
 */
export function isVerticallyScrollable(
  overflowY: string,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return (
    (overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay") &&
    scrollHeight > clientHeight + 1
  );
}
