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
    /** Download and install updates automatically, on when missing */
    autoUpdate?: boolean;
    /** Look for running games to offer streaming them, on when missing */
    gameDetection?: boolean;
    /** Show the in-game voice overlay, off when missing */
    overlayEnabled?: boolean;
    /** Screen corner of the overlay, top left when missing */
    overlayCorner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    /** When the overlay shows, only with a detected game when missing */
    overlayMode?: "always" | "games";
    /** How much the overlay shows, detailed when missing */
    overlayStyle?: "compact" | "detailed";
    /** Server the app loads, empty for the default */
    serverUrl: string;
    windowState: {
      isMaximised: boolean;
    };
  };

  /** A window of a running game that can be captured */
  type RunningGameWindow = {
    /** Capture source id to pass to setNextScreenSource */
    sourceId: string;
    title: string;
    role: "game" | "client";
  };

  /** A game the desktop app found running on this computer */
  type RunningGame = {
    id: string;
    name: string;
    /** Ordered by priority (game before client), can be empty */
    windows: RunningGameWindow[];
  };

  /** Where the desktop auto-updater is */
  type UpdaterStatus =
    | "unsupported"
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";

  /** State reported by the desktop auto-updater */
  interface UpdaterState {
    status: UpdaterStatus;
    /** Version of the update, when there is one */
    version?: string;
    /** Download progress, 0 to 100 */
    percent?: number;
    error?: string;
  }

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
      /** Games running now, missing in older desktop versions */
      getRunningGames?(): Promise<RunningGame[]>;
      /** The detected game that owns the window in front, missing in older desktop versions */
      getFocusedGame?(): Promise<{ id: string; sourceId: string } | null>;
      /** Listen for changes of the running games, returns a function to stop listening */
      onRunningGamesChanged?(cb: (games: RunningGame[]) => void): () => void;
      /**
       * One-shot: the next screen capture skips the picker and captures this
       * source (falls back to the picker if it is gone). null clears it.
       */
      setNextScreenSource?(sourceId: string | null): Promise<void>;
      /** Sends the call snapshot to the in-game overlay, missing in older desktop versions */
      setOverlayState?(state: {
        inCall: boolean;
        /** Translated text of the LIVE tag */
        liveLabel?: string;
        participants: {
          id: string;
          name: string;
          avatar?: string;
          speaking: boolean;
          streaming: boolean;
        }[];
      }): Promise<void>;
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

    /**
     * Auto-updater of the desktop app, missing in older desktop versions
     */
    desktopUpdater?: {
      getState(): Promise<UpdaterState>;
      check(): Promise<void>;
      download(): Promise<void>;
      /** Quits AnyTalk and installs the downloaded update */
      install(): void;
      /** Listen for state changes, returns a function to stop listening */
      onState(cb: (state: UpdaterState) => void): () => void;
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
