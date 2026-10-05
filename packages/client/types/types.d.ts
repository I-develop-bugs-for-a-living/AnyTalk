import type { SolidOptions } from "solid-dnd-directive";
import { Setter } from "solid-js";

import type { Placement } from "@floating-ui/dom";
import type { Channel, Client, ServerMember, ServerRole, User } from "stoat.js";

declare global {
  /**
   * Settings of the AnyTalk desktop app, stored by the native shell
   */
  type DesktopConfig = {
    firstLaunch: boolean;
    customFrame: boolean;
    minimiseToTray: boolean;
    startMinimisedToTray: boolean;
    spellchecker: boolean;
    hardwareAcceleration: boolean;
    discordRpc: boolean;
    /** Server the app loads, empty for the default */
    serverUrl: string;
    windowState: {
      isMaximised: boolean;
    };
  };

  interface Window {
    __TAURI__: object;

    /**
     * Bridge to the desktop shell, only present in the desktop app
     */
    native: {
      versions: {
        node(): string;
        chrome(): string;
        electron(): string;
        desktop(): string;
      };
      platform: "win32" | "linux" | "darwin";
      isWayland(): boolean;
      desktopEnvironment: string;
      minimise(): Promise<void>;
      maximise(): Promise<void>;
      /** Closes the window, or hides it in the tray if minimiseToTray is on */
      close(): Promise<void>;
      /** Listen for the window being maximised or restored, returns a function to stop listening */
      onMaximiseChange(cb: (maximised: boolean) => void): () => void;
      onceScreenPicker(
        onScreenPick: (
          sources: {
            idx: number;
            name: string;
            isFullScreen: boolean;
            image?: string;
          }[],
        ) => void,
      ): void;
      screenPickerCallback(idx: number, audio: boolean): Promise<void>;
      /** Replaces all global hotkeys, resolves with which ones registered */
      setGlobalHotkeys(
        bindings: { action: string; accelerator: string }[],
      ): Promise<{ action: string; registered: boolean }[]>;
      /** Listen for global hotkeys, returns a function to stop listening */
      onGlobalHotkey(cb: (action: string) => void): () => void;
    };

    /**
     * Desktop app settings, only present in the desktop app
     */
    desktopConfig: {
      /** Cached copy of the settings, updated by every set() */
      get(): DesktopConfig;
      /**
       * Change settings (only the ones in the shell's allow list), resolves
       * with the updated settings and rejects for invalid values
       */
      set(config: Partial<DesktopConfig>): Promise<DesktopConfig>;
      getAutostart(): Promise<boolean>;
      setAutostart(value: boolean): Promise<boolean>;
      /** Server the app loads when serverUrl is empty */
      getDefaultServerUrl(): Promise<string>;
    };
  }
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      dndzone: SolidOptions & {
        transformDraggedElement?: () => (element?: HTMLElement) => void;
        useCursorForDetection?: boolean | (() => boolean);
        dropAnimationDisabled?: boolean | (() => boolean);
      };

      scrollable:
        | true
        | {
            /**
             * Colour customisation
             */
            palette?: "default" | "settings";

            /**
             * Scroll direction
             */
            direction?: "x" | "y";

            /**
             * Offset to apply to top of scroll container
             */
            offsetTop?: number;

            /**
             * Whether to only show scrollbar on hover
             */
            showOnHover?: boolean;

            /**
             * Pass-through class names
             */
            class?: string;
          };
      invisibleScrollable:
        | true
        | {
            /**
             * Scroll direction
             */
            direction?: "x" | "y";

            /**
             * Pass-through class names
             */
            class?: string;
          };
      floating: {
        tooltip?: {
          /**
           * Where the tooltip should be placed
           */
          placement: Placement;
        } & (
          | {
              /**
               * Tooltip content
               */
              content: Component;

              /**
               * Aria label fallback
               */
              aria: string;
            }
          | {
              /**
               * Tooltip content
               */
              content: string | undefined;

              /**
               * Content is used as aria fallback
               */
              aria?: undefined;
            }
        );
        userCard?: {
          /**
           * User to display
           */
          user: User;

          /**
           * Member to display
           */
          member?: ServerMember;

          /**
           * Bot to display
           */
          bot?: { owner: string };
        };
        contextMenu?: Component;
        contextMenuHandler?: "click" | "contextmenu";
        autoComplete?: {
          state: Accessor<AutoCompleteState>;
          selection: Accessor<number>;
          setSelection: Setter<number>;
          select: (index: number) => void;
        };
      };
      autoComplete:
        | true
        | {
            client?: Client;
            onKeyDown?: (
              event: KeyboardEvent & { currentTarget: HTMLTextAreaElement },
            ) => void;
            searchSpace?: {
              users?: User[];
              members?: ServerMember[];
              channels?: Channel[];
              roles?: ServerRole[];
            };
          };
    }
  }
}
