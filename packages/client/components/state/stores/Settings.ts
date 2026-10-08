import {
  UNICODE_EMOJI_PACKS,
  UnicodeEmojiPacks,
} from "@revolt/markdown/emoji/UnicodeEmoji";
import { batch } from "solid-js";
import { reconcile } from "solid-js/store";

import { State } from "..";

import { AbstractStore } from ".";
import {
  DEFAULT_RECENT_CALLS_SHOWN,
  clampRecentCallsShown,
} from "./recentCalls";

/**
 * Possible notification permission states
 */
export type NotificationPermissionState =
  | "default"
  | "denied"
  | "allowed"
  | "unsupported";

/**
 * Possible notification permission states
 */
const NotificationPermissionStates: NotificationPermissionState[] = [
  "default",
  "denied",
  "allowed",
  "unsupported",
];

interface SettingsDefinition {
  /**
   * Whether to enable desktop notifications
   */
  "notifications:desktop": NotificationPermissionState;

  /**
   * Whether to enable push notifications
   */
  "notifications:push": NotificationPermissionState;

  /**
   * Selected unicode emoji
   */
  "appearance:unicode_emoji": UnicodeEmojiPacks;

  // TODO: this should be part of theme
  // "appearance:ligatures": boolean;

  /**
   * Enable season effects
   * TODO: implement
   */
  // "appearance:seasonal": boolean;

  // TODO: this should be part of theme
  // "appearance:transparency": boolean;

  /**
   * Show message send button
   */
  "appearance:show_send_button": boolean;

  /**
   * Whether to render messages in compact mode
   */
  "appearance:compact_mode": boolean;

  /**
   * Indicate new users to Stoat
   * TODO: implement
   */
  // "appearance:show_account_age": boolean;

  /**
   * Whether to include 'copy ID' in context menus
   */
  "advanced:copy_id": boolean;

  /**
   * Whether to include admin panel links in context menus
   */
  "advanced:admin_panel": boolean;

  /**
   * Whether to show a notice on the home page when a new version of the
   * app is available
   */
  "advanced:update_notice": boolean;

  /**
   * Whether stream developer tools are on (live video statistics and
   * stream recaps); named before voice developer tools existed
   */
  "advanced:developer_mode": boolean;

  /**
   * Whether developer mode shows live statistics on call video tiles
   */
  "advanced:developer_overlay": boolean;

  /**
   * Whether developer mode records stream recaps
   */
  "advanced:developer_record": boolean;

  /**
   * Whether voice call developer tools are on
   */
  "advanced:developer_voice": boolean;

  /**
   * Whether voice developer mode shows live audio statistics on call tiles
   */
  "advanced:developer_voice_overlay": boolean;

  /**
   * Whether voice developer mode records call recaps
   */
  "advanced:developer_voice_record": boolean;

  /**
   * How many recently joined calls the Home page lists, 0 hides them
   */
  "advanced:recent_calls_shown": number;

  /**
   * Whether a game controller can drive the app
   */
  "controller:enabled": boolean;

  /**
   * User changes to keybinds, by keybind action
   */
  "keybinds:custom": Record<string, CustomKeybind>;
}

/**
 * A user's choice for one keybind
 */
export interface CustomKeybind {
  enabled: boolean;
  /** Keys to hold together, as tracked by the keybind handler */
  keys: string[];
}

/**
 * Keep only well-formed keybind entries
 */
function cleanKeybinds(
  input: unknown,
): Record<string, CustomKeybind> | undefined {
  if (typeof input !== "object" || !input) return;

  const out: Record<string, CustomKeybind> = {};
  for (const [action, value] of Object.entries(input)) {
    const { enabled, keys } = (value ?? {}) as Partial<CustomKeybind>;
    if (
      typeof enabled === "boolean" &&
      Array.isArray(keys) &&
      keys.length &&
      keys.every((key) => typeof key === "string")
    ) {
      out[action] = { enabled, keys };
    }
  }

  return out;
}

/**
 * Map actual type to JavaScript type OR function to clean the value.
 */
type ValueType<T extends keyof SettingsDefinition> =
  SettingsDefinition[T] extends boolean
    ? "boolean"
    : SettingsDefinition[T] extends number
      ? "number"
      : SettingsDefinition[T] extends string
        ? "string"
        : (
            v: Partial<SettingsDefinition[T]>,
          ) => SettingsDefinition[T] | undefined;

/**
 * Expected types of settings keys, enforce some sort of validation is present for all keys.
 * If we cannot validate the value as a primitive, clean it up using a function.
 */
const EXPECTED_TYPES: { [K in keyof SettingsDefinition]: ValueType<K> } = {
  "notifications:desktop": "string",
  "notifications:push": "string",
  "appearance:unicode_emoji": "string",
  "appearance:show_send_button": "boolean",
  "appearance:compact_mode": "boolean",
  "advanced:copy_id": "boolean",
  "advanced:admin_panel": "boolean",
  "advanced:update_notice": "boolean",
  "advanced:developer_mode": "boolean",
  "advanced:developer_overlay": "boolean",
  "advanced:developer_record": "boolean",
  "advanced:developer_voice": "boolean",
  "advanced:developer_voice_overlay": "boolean",
  "advanced:developer_voice_record": "boolean",
  "advanced:recent_calls_shown": "number",
  "controller:enabled": "boolean",
  "keybinds:custom": cleanKeybinds,
};

/**
 * In reality, this is a partial so we map it accordingly here.
 */
export type TypeSettings = Partial<SettingsDefinition>;

/**
 * Default values for settings, if applicable.
 */
const DEFAULT_VALUES: TypeSettings = {};

/**
 * Settings store
 */
export class Settings extends AbstractStore<"settings", TypeSettings> {
  /**
   * Construct store
   * @param state State
   */
  constructor(state: State) {
    super(state, "settings");
  }

  /**
   * Hydrate external context
   */
  hydrate(): void {
    /** nothing needs to be done */
  }

  /**
   * Generate default values
   */
  default(): TypeSettings {
    return {
      "notifications:desktop": "default",
      "notifications:push": "default",
      "appearance:unicode_emoji": "fluent-3d",
      "appearance:show_send_button": true,
      "appearance:compact_mode": false,
      "advanced:copy_id": false,
      "advanced:admin_panel": false,
      "advanced:update_notice": true,
      "advanced:developer_mode": false,
      "advanced:developer_overlay": true,
      "advanced:developer_record": true,
      "advanced:developer_voice": false,
      "advanced:developer_voice_overlay": true,
      "advanced:developer_voice_record": true,
      "advanced:recent_calls_shown": DEFAULT_RECENT_CALLS_SHOWN,
      "controller:enabled": true,
    };
  }

  /**
   * Validate the given data to see if it is compliant and return a compliant object
   */
  clean(input: Partial<TypeSettings>): TypeSettings {
    const settings: TypeSettings = this.default();

    for (const key of Object.keys(input) as (keyof TypeSettings)[]) {
      const expectedType = EXPECTED_TYPES[key];

      if (typeof expectedType === "function") {
        const cleanedValue = (expectedType as (value: unknown) => unknown)(
          input[key],
        );
        if (cleanedValue) {
          settings[key] = cleanedValue as never;
        }
      } else if (key === "appearance:unicode_emoji") {
        if (UNICODE_EMOJI_PACKS.includes(input[key] as never)) {
          settings[key] = input[key];
        }
      } else if (key === "notifications:desktop") {
        if (NotificationPermissionStates.includes(input[key] as never)) {
          settings[key] = input[key];
        }
      } else if (key === "notifications:push") {
        if (NotificationPermissionStates.includes(input[key] as never)) {
          settings[key] = input[key];
        }
      } else if (typeof input[key] === expectedType) {
        settings[key] = input[key] as never;
      }
    }

    settings["advanced:recent_calls_shown"] = clampRecentCallsShown(
      settings["advanced:recent_calls_shown"],
    );

    return settings;
  }

  /**
   * Set a settings key
   * @param key Colon-divided key
   * @param value Value
   */
  setValue<T extends keyof TypeSettings>(key: T, value: TypeSettings[T]) {
    // a plain object would be merged into the stored one, so keys missing from
    // it (like a reset keybind) would stay; reconcile replaces it instead
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      this.set(key, reconcile(value) as never);
      return;
    }
    this.set(key, value);
  }

  /**
   * Get a settings key
   * @param key Colon-divided key
   * @returns Value at key or default value
   */
  getValue<T extends keyof TypeSettings>(key: T) {
    return this.get()[key] ?? DEFAULT_VALUES[key];
  }

  /**
   * Get the permission state for desktop notifications
   */
  get desktopNotificationsState(): NotificationPermissionState {
    return this.getValue("notifications:desktop") ?? "default";
  }

  /**
   * Get the permission state for push notifications
   */
  get pushNotificationsState(): NotificationPermissionState {
    return this.getValue("notifications:push") ?? "default";
  }

  /**
   * Set the permission state for desktop notifications. If deskop notifications are ever set to `unsupported` this function will noop.
   */
  set desktopNotificationsState(newState: NotificationPermissionState) {
    if (this.desktopNotificationsState !== "unsupported") {
      this.setValue("notifications:desktop", newState);
    }
  }

  /**
   * Set the permission state for push notifications. If newState is `unsupported` this function will noop.
   */
  set pushNotificationsState(newState: NotificationPermissionState) {
    if (newState !== "unsupported") {
      this.setValue("notifications:push", newState);
    }
  }

  /**
   * Reset the notifications state for both desktop and push notifications.
   * @param newState The state to set both notification states to. Defaults to "default"
   */
  resetNotificationsState(newState?: "default" | "denied") {
    batch(() => {
      // Use setValue here instead of the setter as we want to bypass the unsupported block.
      this.setValue("notifications:desktop", newState ?? "default");
      this.pushNotificationsState = newState ?? "default";
    });
  }
}
