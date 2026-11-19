import { onCleanup } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import { Column, Dialog, DialogProps, Form2 } from "@revolt/ui";
import { createFormControl, createFormGroup } from "solid-forms";

import { Modals } from "../types";

/**
 * Longest passkey name the dialog accepts
 */
const MAX_NAME_LENGTH = 50;

/**
 * Modal asking for the name of a passkey, when adding one or renaming it
 */
export function PasskeyNameModal(
  props: DialogProps & Modals & { type: "passkey_name" },
) {
  const { t } = useLingui();
  let answered = false;

  const group = createFormGroup({
    name: createFormControl(props.initial, { required: true }),
  });

  /**
   * Report the answer once, whichever way the dialog is closed
   * @param name The chosen name, or undefined if cancelled
   */
  function answer(name?: string) {
    if (answered) return;
    answered = true;
    props.callback(name);
  }

  // Safety net: never leave the caller waiting if the modal is torn down
  onCleanup(() => answer(undefined));

  /**
   * Confirm with the entered name. Always returns false on purpose: the dialog
   * closes itself through `props.onClose()` after the answer is sent, so the
   * Dialog action must not close it a second time.
   * @returns Whether the dialog may close (never: see above)
   */
  function confirm() {
    const name = group.controls.name.value.trim();
    if (!name) return false;
    answer(name.slice(0, MAX_NAME_LENGTH));
    props.onClose();
    return false;
  }

  const submit = Form2.useSubmitHandler(group, () => {
    confirm();
  });

  return (
    <Dialog
      show={props.show}
      onClose={() => {
        answer(undefined);
        props.onClose();
      }}
      title={
        props.mode === "add" ? (
          <Trans>Name your passkey</Trans>
        ) : (
          <Trans>Rename passkey</Trans>
        )
      }
      actions={[
        { text: <Trans>Cancel</Trans>, onClick: () => answer(undefined) },
        {
          text:
            props.mode === "add" ? (
              <Trans>Continue</Trans>
            ) : (
              <Trans>Rename</Trans>
            ),
          onClick: confirm,
          isDisabled: !group.controls.name.value.trim(),
        },
      ]}
    >
      <form onSubmit={submit}>
        <Column>
          <Form2.TextField
            name="name"
            control={group.controls.name}
            label={t`Name`}
            placeholder={t`For example the name of this device`}
            maxlength={MAX_NAME_LENGTH}
            autoFocus
          />
        </Column>
      </form>
    </Dialog>
  );
}
