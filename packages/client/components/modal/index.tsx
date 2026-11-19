import {
  For,
  JSXElement,
  Show,
  batch,
  createContext,
  useContext,
} from "solid-js";
import { SetStoreFunction, createStore } from "solid-js/store";

import type { MFA, MFATicket } from "stoat.js";

import type { CredentialJson, OptionsJson } from "@revolt/client/webauthn";
import { Keybind, KeybindAction } from "@revolt/keybinds";
import { dismissFloatingElements } from "@revolt/ui";

import { RenderModal } from "./modals";
import { Modals } from "./types";

export type ActiveModal = {
  /**
   * Unique modal Id
   */
  id: string;

  /**
   * Whether to show the modal
   */
  show: boolean;

  /**
   * Props to pass to modal
   */
  props: Modals;
};

/**
 * Global modal controller for layering and displaying one or more modal to the user
 */
export class ModalController {
  modals: ActiveModal[];
  setModals: SetStoreFunction<ActiveModal[]>;

  /**
   * Construct controller
   */
  constructor() {
    const [modals, setModals] = createStore<ActiveModal[]>([]);
    // eslint-disable-next-line solid/reactivity
    this.modals = modals;
    this.setModals = setModals;

    this.openModal = this.openModal.bind(this);
    this.pop = this.pop.bind(this);
    this.remove = this.remove.bind(this);
    this.isOpen = this.isOpen.bind(this);
    this.closeAll = this.closeAll.bind(this);
  }

  /**
   * Add a modal to the stack
   * @param props Modal parameters
   * @returns The id of the modal, to close it with `remove`
   */
  openModal(props: Modals): string {
    //Unique ID from clock that can't run backwards
    const id = performance.now().toString();
    this.setModals((modals) => [
      ...modals,
      {
        id,
        show: true,
        props,
      },
    ]);
    dismissFloatingElements();
    return id;
    // after modal commits to DOM,
    // we can begin animations!
    // setTimeout(
    //   () =>
    //     this.setModals((modals) =>
    //       modals.map((modal) =>
    //         modal.id === id ? { ...modal, show: true } : modal,
    //       ),
    //     ),
    //   0,
    // );
  }

  /**
   * Remove the top modal
   */
  pop() {
    const modal = [...this.modals].reverse().find((modal) => modal.show);

    if (modal) {
      this.remove(modal.id);
    }
  }

  /**
   * Remove all modals
   */
  closeAll() {
    batch(() => {
      for (const modal of this.modals) {
        this.remove(modal.id);
      }
    });
  }

  /**
   * Close modal by id
   */
  remove(id: string) {
    this.setModals((entry) => entry.id === id, "show", false);

    setTimeout(() => {
      this.setModals(this.modals.filter((entry) => entry.id !== id));
    }, 500); /** FIXME / TODO: set to motion anim time + 100ms */
  }

  /**
   * Whether a modal is currently open
   * @returns Boolean
   */
  isOpen(type?: string) {
    return type
      ? !!this.modals.find((x) => x.show && x.props.type === type)
      : !!this.modals.find((x) => x.show);
  }
}

/**
 * Modal controller with additional helpers.
 */
export class ModalControllerExtended extends ModalController {
  /**
   * Construct controller
   */
  constructor() {
    super();

    this.mfaFlow = this.mfaFlow.bind(this);
    this.mfaEnableTOTP = this.mfaEnableTOTP.bind(this);
    this.confirmRemoveAuthenticator =
      this.confirmRemoveAuthenticator.bind(this);
    this.askPasskeyName = this.askPasskeyName.bind(this);
    this.confirmRemovePasskey = this.confirmRemovePasskey.bind(this);
    this.askCreatePasskey = this.askCreatePasskey.bind(this);
    this.showError = this.showError.bind(this);
    this.openLink = this.openLink.bind(this);
  }

  /**
   * Perform MFA flow
   * @param mfa MFA helper
   */
  mfaFlow(mfa: MFA) {
    return new Promise((callback: (ticket?: MFATicket) => void) =>
      this.openModal({
        type: "mfa_flow",
        state: "known",
        mfa,
        callback,
      }),
    );
  }

  /**
   * Ask the user to confirm removing the authenticator app
   * @returns Whether the user confirmed
   */
  confirmRemoveAuthenticator() {
    return new Promise<boolean>((callback) =>
      this.openModal({ type: "mfa_remove_authenticator", callback }),
    );
  }

  /**
   * Ask for the name of a passkey
   * @param mode Adding a new one or renaming
   * @param initial Name to start with
   * @returns The name, or undefined if cancelled
   */
  askPasskeyName(mode: "add" | "rename", initial: string) {
    return new Promise<string | undefined>((callback) =>
      this.openModal({ type: "passkey_name", mode, initial, callback }),
    );
  }

  /**
   * Ask the user to confirm removing a passkey
   * @param name Name of the passkey
   * @param turnsOffTwoFactor Whether removing it leaves no second factor
   * @returns Whether the user confirmed
   */
  confirmRemovePasskey(name: string, turnsOffTwoFactor: boolean) {
    return new Promise<boolean>((callback) =>
      this.openModal({
        type: "passkey_remove",
        name,
        turnsOffTwoFactor,
        callback,
      }),
    );
  }

  /**
   * Show the step that creates a passkey from a tap, so the browser accepts it
   * @param options Registration options from the server
   * @returns The credential or the error, or undefined if cancelled
   */
  askCreatePasskey(options: OptionsJson) {
    return new Promise<
      { credential: CredentialJson } | { error: unknown } | undefined
    >((callback) =>
      this.openModal({ type: "passkey_create", options, callback }),
    );
  }

  /**
   * Open TOTP secret modal
   *
   * The modal stays open until the code is accepted or the user backs out, so
   * a rejected code can be reported without the dialog closing underneath it.
   * @param secret Secret to display
   * @param identifier Account identifier shown in the authenticator app
   * @param enable Called with the entered code, should throw if it is rejected
   * @returns Whether the authenticator was enabled
   */
  mfaEnableTOTP(
    secret: string,
    identifier: string,
    enable: (code: string) => Promise<void>,
  ) {
    return new Promise((resolve: (value: boolean) => void, reject) =>
      this.openModal({
        type: "mfa_enable_totp",
        identifier,
        secret,
        async callback(code) {
          if (!code) return resolve(false);
          await enable(code);
          resolve(true);
        },
        reject,
      }),
    );
  }

  /**
   * Show any error
   * @param error Error
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  showError(error: any) {
    this.openModal({
      type: "error2",
      error,
    });
  }

  /**
   * Write text to the clipboard
   * @param text Text to write
   * @deprecated use navigator clipboard directly
   */
  writeText(text: string) {
    navigator.clipboard.writeText(text);
  }

  /**
   * Safely open external or internal link
   * @param href Raw URL
   * @param trusted Whether we trust this link
   * @returns Whether to cancel default event
   */
  openLink(/*href?: string, trusted?: boolean*/) {
    /*const link = determineLink(href);
    const settings = getApplicationState().settings;

    switch (link.type) {
      case "navigate": {
        history.push(link.path);
        break;
      }
      case "external": {
        if (!trusted && !settings.security.isTrustedOrigin(link.url.hostname)) {
          modalController.push({
            type: "link_warning",
            link: link.href,
            callback: () => this.openLink(href, true) as true,
          });
        } else {
          window.open(link.href, "_blank", "noreferrer");
        }
      }
    }*/

    return true;
  }
}

const ModalControllerContext = createContext<ModalControllerExtended>(
  null as unknown as ModalControllerExtended,
);

/**
 * Mount the modal controller
 */
export function ModalContext(props: { children: JSXElement }) {
  const controller = new ModalControllerExtended();

  return (
    <ModalControllerContext.Provider value={controller}>
      {props.children}
    </ModalControllerContext.Provider>
  );
}

/**
 * Use the modal controller
 */
export function useModals() {
  return useContext(ModalControllerContext);
}

/**
 * Render modals
 */
export function ModalRenderer() {
  const modalController = useModals();

  return (
    <>
      <For each={modalController.modals}>
        {(entry) => (
          <RenderModal
            {...entry}
            onClose={() => modalController.remove(entry.id)}
          />
        )}
      </For>
      <Show when={modalController.isOpen()}>
        <Keybind
          keybind={KeybindAction.CLOSE_MODAL}
          onPressed={() => modalController.pop()}
        />
      </Show>
    </>
  );
}
