import { onCleanup } from "solid-js";

import { Trans } from "@lingui/solid/macro";

import { Dialog, DialogProps } from "@revolt/ui";

import { Modals } from "../types";

/**
 * Modal asking to confirm removing the authenticator app (turns 2FA off)
 */
export function MFARemoveAuthenticatorModal(
  props: DialogProps & Modals & { type: "mfa_remove_authenticator" },
) {
  let answered = false;

  /**
   * Report the answer once, whichever way the dialog is closed
   * @param confirmed Whether the user confirmed
   */
  function answer(confirmed: boolean) {
    if (answered) return;
    answered = true;
    props.callback(confirmed);
  }

  // Safety net: never leave the caller waiting if the modal is torn down
  onCleanup(() => answer(false));

  return (
    <Dialog
      show={props.show}
      onClose={() => {
        answer(false);
        props.onClose();
      }}
      title={<Trans>Remove authenticator app?</Trans>}
      actions={[
        { text: <Trans>Cancel</Trans>, onClick: () => answer(false) },
        { text: <Trans>Remove</Trans>, onClick: () => answer(true) },
      ]}
    >
      <Trans>
        Two-factor authentication will be turned off for your account. You can
        turn it on again by setting up an authenticator app.
      </Trans>
    </Dialog>
  );
}
