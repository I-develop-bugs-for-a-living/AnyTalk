import { createSignal, onCleanup } from "solid-js";

import { Trans } from "@lingui/solid/macro";

import { createPasskeyCredential } from "@revolt/client/passkeyApi";
import { isPromptCancelled } from "@revolt/client/webauthn";
import { Dialog, DialogProps, Text } from "@revolt/ui";

import { Modals } from "../types";

/**
 * Modal with the last step of adding a passkey. Safari only lets the browser
 * create a passkey straight from a tap, and the earlier network requests use
 * that tap up, so the creation starts from this dialog's own button.
 */
export function PasskeyCreateModal(
  props: DialogProps & Modals & { type: "passkey_create" },
) {
  let answered = false;
  // set while the browser prompt is open, so a second tap can't abort it
  let busy = false;
  const [dismissed, setDismissed] = createSignal(false);

  /**
   * Report the answer once, whichever way the dialog is closed
   * @param result Credential or error, or undefined if cancelled
   */
  function answer(result?: Parameters<typeof props.callback>[0]) {
    if (answered) return;
    answered = true;
    props.callback(result);
  }

  // Safety net: never leave the caller waiting if the modal is torn down
  onCleanup(() => answer(undefined));

  /**
   * Ask the browser to create the passkey. Must be called straight from the
   * tap, with nothing awaited before it.
   */
  function create() {
    if (busy) return;
    busy = true;
    setDismissed(false);
    createPasskeyCredential(props.options).then(
      // eslint-disable-next-line solid/reactivity -- runs once after the tap, reading props is fine
      (credential) => {
        busy = false;
        // closed meanwhile: the caller already got its answer
        if (answered) return;
        if (!credential) {
          setDismissed(true);
          return;
        }
        answer({ credential });
        props.onClose();
      },
      // eslint-disable-next-line solid/reactivity -- runs once after the tap, reading props is fine
      (error) => {
        busy = false;
        if (answered) return;
        if (isPromptCancelled(error)) {
          // the challenge is not spent by a dismissed prompt: allow a retry
          setDismissed(true);
          return;
        }
        answer({ error });
        props.onClose();
      },
    );
  }

  return (
    <Dialog
      show={props.show}
      onClose={() => {
        answer(undefined);
        props.onClose();
      }}
      title={<Trans>Create your passkey</Trans>}
      actions={[
        { text: <Trans>Cancel</Trans>, onClick: () => answer(undefined) },
        {
          text: <Trans>Create passkey</Trans>,
          onClick: () => {
            create();
            return false;
          },
        },
      ]}
    >
      <Text>
        <Trans>
          Choose Create passkey, then confirm with your device when it asks.
        </Trans>
      </Text>
      <div role="status">
        {dismissed() && (
          <Text>
            <Trans>
              The passkey was not created. Choose Create passkey to try again.
            </Trans>
          </Text>
        )}
      </div>
    </Dialog>
  );
}
