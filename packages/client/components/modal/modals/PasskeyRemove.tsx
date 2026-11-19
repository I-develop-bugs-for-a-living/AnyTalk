import { Show, onCleanup } from "solid-js";

import { Trans } from "@lingui/solid/macro";

import { Dialog, DialogProps, Text } from "@revolt/ui";

import { Modals } from "../types";

/**
 * Modal asking to confirm removing a passkey
 */
export function PasskeyRemoveModal(
  props: DialogProps & Modals & { type: "passkey_remove" },
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
      title={<Trans>Remove passkey?</Trans>}
      actions={[
        { text: <Trans>Cancel</Trans>, onClick: () => answer(false) },
        { text: <Trans>Remove</Trans>, onClick: () => answer(true) },
      ]}
    >
      <Trans>
        "{props.name}" will no longer work for signing in or confirming actions.
        You can add it again later.
      </Trans>
      <Show when={props.turnsOffTwoFactor}>
        <Text>
          <Trans>
            This is your last second factor, so two-factor authentication will
            be turned off.
          </Trans>
        </Text>
      </Show>
    </Dialog>
  );
}
