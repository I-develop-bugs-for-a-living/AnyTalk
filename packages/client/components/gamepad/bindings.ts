/**
 * Which controller button does what. The defaults live here, the user's
 * changes are stored as overrides (see the `controller:bindings` setting) and
 * merged on top. Pure logic, so it can be tested directly.
 *
 * Buttons are stored by name (never by index), see input.ts.
 */
import { type PressButton, PRESS_BUTTONS } from "./input";

/** Things a controller button can do */
export enum ControllerAction {
  ACTIVATE = "activate",
  BACK = "back",
  CONTEXT_MENU = "contextMenu",
  CYCLE_REGION = "cycleRegion",
  FOCUS_COMPOSER = "focusComposer",
  CHANNEL_UP = "channelUp",
  CHANNEL_DOWN = "channelDown",
  SERVER_UP = "serverUp",
  SERVER_DOWN = "serverDown",
  TOGGLE_MUTE = "toggleMute",
  TOGGLE_DEAFEN = "toggleDeafen",
}

/** A button that can be given an action */
export type ButtonName = PressButton;

/** What is stored: an action to a button, or null for unbound */
export type BindingOverrides = Partial<
  Record<ControllerAction, ButtonName | null>
>;

/** Every action, in the order the settings page lists them */
export const CONTROLLER_ACTIONS: ControllerAction[] = Object.values(
  ControllerAction,
) as ControllerAction[];

/** Buttons that can be given an action */
export const BINDABLE_BUTTONS: readonly ButtonName[] = PRESS_BUTTONS;

/**
 * Actions that always stay bound, because without them the app can't be
 * used with a controller
 */
export const ESSENTIAL_ACTIONS: ReadonlySet<ControllerAction> = new Set([
  ControllerAction.ACTIVATE,
  ControllerAction.BACK,
  ControllerAction.CONTEXT_MENU,
  ControllerAction.CYCLE_REGION,
]);

/** Button of each action when the user changed nothing */
export const DEFAULT_BINDINGS: Record<ControllerAction, ButtonName | null> = {
  [ControllerAction.ACTIVATE]: "a",
  [ControllerAction.BACK]: "b",
  [ControllerAction.CONTEXT_MENU]: "x",
  [ControllerAction.CYCLE_REGION]: "start",
  [ControllerAction.FOCUS_COMPOSER]: "y",
  [ControllerAction.CHANNEL_UP]: "lb",
  [ControllerAction.CHANNEL_DOWN]: "rb",
  [ControllerAction.SERVER_UP]: "lt",
  [ControllerAction.SERVER_DOWN]: "rt",
  [ControllerAction.TOGGLE_MUTE]: "select",
  [ControllerAction.TOGGLE_DEAFEN]: null,
};

/**
 * Whether a value is a known action
 * @param value Anything
 * @returns Boolean
 */
export function isControllerAction(value: unknown): value is ControllerAction {
  return (CONTROLLER_ACTIONS as unknown[]).includes(value);
}

/**
 * Whether a value is the name of a bindable button
 * @param value Anything
 * @returns Boolean
 */
export function isBindableButton(value: unknown): value is ButtonName {
  return (BINDABLE_BUTTONS as readonly unknown[]).includes(value);
}

/**
 * Keep only overrides with a known action and a known button (or null)
 * @param input Saved value
 * @returns Clean overrides, or undefined when it isn't an object
 */
export function cleanBindingOverrides(
  input: unknown,
): BindingOverrides | undefined {
  if (typeof input !== "object" || !input || Array.isArray(input)) return;

  const out: BindingOverrides = {};
  for (const [action, button] of Object.entries(input)) {
    if (!isControllerAction(action)) continue;
    if (button === null || isBindableButton(button)) out[action] = button;
  }
  return out;
}

/**
 * Drop overrides that equal the default
 * @param overrides Overrides
 * @returns Overrides without the redundant entries
 */
function prune(overrides: BindingOverrides): BindingOverrides {
  const out: BindingOverrides = {};
  for (const action of CONTROLLER_ACTIONS) {
    const value = overrides[action];
    if (value !== undefined && value !== DEFAULT_BINDINGS[action]) {
      out[action] = value;
    }
  }
  return out;
}

/**
 * The button of every action: defaults with the overrides on top. A button
 * never has two actions, and essential actions always keep one: an essential
 * action without an override holds its default button, so an optional action
 * that was stored with that button loses and ends up unbound.
 * @param overrides Saved overrides
 * @returns Button per action
 */
export function resolveBindings(
  overrides: BindingOverrides = {},
): Record<ControllerAction, ButtonName | null> {
  const clean = cleanBindingOverrides(overrides) ?? {};
  const out = { ...DEFAULT_BINDINGS };
  const taken = new Set<ButtonName>();

  /**
   * Hold a button for an action if it is free
   * @param action Action
   * @param button Button
   * @returns Whether it was taken
   */
  const take = (action: ControllerAction, button: ButtonName | null) => {
    if (!button || taken.has(button)) return false;
    taken.add(button);
    out[action] = button;
    return true;
  };

  const essential = CONTROLLER_ACTIONS.filter((a) => ESSENTIAL_ACTIONS.has(a));
  const optional = CONTROLLER_ACTIONS.filter((a) => !ESSENTIAL_ACTIONS.has(a));

  // essential actions without a change keep their default first
  for (const action of essential) {
    if (!clean[action]) take(action, DEFAULT_BINDINGS[action]);
  }
  // then those the user moved, falling back to the default
  for (const action of essential) {
    const value = clean[action];
    if (
      value &&
      !take(action, value) &&
      !take(action, DEFAULT_BINDINGS[action])
    ) {
      out[action] = null;
    }
  }

  // optional actions take what is left, the user's choices before defaults
  for (const action of optional) out[action] = null;
  for (const action of optional) {
    const value = clean[action];
    if (value) take(action, value);
  }
  for (const action of optional) {
    if (clean[action] === undefined) take(action, DEFAULT_BINDINGS[action]);
  }

  return out;
}

/**
 * The action a button does
 * @param bindings Button per action (see resolveBindings)
 * @param button Pressed button
 * @returns Action, or undefined when the button does nothing
 */
export function actionForButton(
  bindings: Record<ControllerAction, ButtonName | null>,
  button: string,
): ControllerAction | undefined {
  return CONTROLLER_ACTIONS.find((action) => bindings[action] === button);
}

/**
 * Which essential action would be left without a button if an action took a
 * button. Taking a button swaps with its owner, and that fails when the owner
 * is essential and the action has no button to hand over.
 * @param overrides Saved overrides
 * @param action Action that gets the button
 * @param button The button
 * @returns The essential action that stands in the way, if any
 */
export function rebindBlocker(
  overrides: BindingOverrides,
  action: ControllerAction,
  button: ButtonName,
): ControllerAction | undefined {
  const bindings = resolveBindings(overrides);
  const owner = actionForButton(bindings, button);
  if (!owner || owner === action) return;
  if (bindings[action] === null && ESSENTIAL_ACTIONS.has(owner)) return owner;
}

/**
 * Give an action a button. If another action has that button, the two swap:
 * the other action gets the button this one had, or none if it had none. Does
 * nothing when that would unbind an essential action (see rebindBlocker).
 * @param overrides Saved overrides
 * @param action Action that gets the button
 * @param button The button
 * @returns New overrides
 */
export function rebind(
  overrides: BindingOverrides,
  action: ControllerAction,
  button: ButtonName,
): BindingOverrides {
  if (rebindBlocker(overrides, action, button)) return overrides;

  const bindings = resolveBindings(overrides);
  const owner = actionForButton(bindings, button);
  const next: BindingOverrides = { ...resolveBindings(overrides) };

  if (owner && owner !== action) next[owner] = bindings[action];
  next[action] = button;

  return prune(next);
}

/**
 * Take the button off an optional action. Essential actions stay as they are.
 * @param overrides Saved overrides
 * @param action Action to unbind
 * @returns New overrides
 */
export function unbind(
  overrides: BindingOverrides,
  action: ControllerAction,
): BindingOverrides {
  if (ESSENTIAL_ACTIONS.has(action)) return overrides;
  return prune({ ...resolveBindings(overrides), [action]: null });
}

/**
 * Put one action back to its default button, swapping with whatever has it now
 * @param overrides Saved overrides
 * @param action Action to reset
 * @returns New overrides, unchanged when the default button belongs to an
 * essential action that can't give it up (see rebindBlocker)
 */
export function resetAction(
  overrides: BindingOverrides,
  action: ControllerAction,
): BindingOverrides {
  const button = DEFAULT_BINDINGS[action];
  return button ? rebind(overrides, action, button) : unbind(overrides, action);
}
