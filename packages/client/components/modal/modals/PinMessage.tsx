import { Trans } from "@lingui/solid/macro";
import { useMutation } from "@tanstack/solid-query";

import { setMessagePinned, useClient } from "@revolt/client";
import { Dialog, DialogProps } from "@revolt/ui";

import { useModals } from "..";
import { Modals } from "../types";

/**
 * Modal to pin or unpin a message
 */
export function PinMessageModal(
  props: DialogProps & Modals & { type: "pin_message" },
) {
  const client = useClient();
  const { showError } = useModals();

  const isPinned = () => props.message.pinned;

  const togglePin = useMutation(() => ({
    mutationFn: () => setMessagePinned(client(), props.message, !isPinned()),
    onError: showError,
    onSuccess: () => props.onClose(),
  }));

  return (
    <Dialog
      show={props.show}
      onClose={props.onClose}
      title={
        isPinned() ? <Trans>Unpin message</Trans> : <Trans>Pin message</Trans>
      }
      actions={[
        { text: <Trans>Cancel</Trans> },
        {
          text: isPinned() ? <Trans>Unpin</Trans> : <Trans>Pin</Trans>,
          onClick: () => togglePin.mutateAsync(),
        },
      ]}
      isDisabled={togglePin.isPending}
    >
      {isPinned() ? (
        <Trans>Are you sure you want to unpin this message?</Trans>
      ) : (
        <Trans>Are you sure you want to pin this message?</Trans>
      )}
    </Dialog>
  );
}
