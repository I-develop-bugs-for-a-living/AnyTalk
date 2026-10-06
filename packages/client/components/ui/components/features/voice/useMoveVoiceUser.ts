import { useLingui } from "@lingui/solid/macro";
import type { Channel } from "stoat.js";

import { useClient } from "@revolt/client";

import { useSnackbar } from "../../design";

import { moveVoiceUser } from "./voiceMove";

/**
 * Get a function that moves someone to another voice channel and tells the
 * user in a snackbar when that fails. Shared by dropping a participant on a
 * channel and the "Move to channel" context menu entry.
 */
export function useMoveVoiceUser() {
  const client = useClient();
  const snackbar = useSnackbar();
  const { t } = useLingui();

  /**
   * @param userId User to move
   * @param to Target channel
   */
  return async function moveWithFeedback(userId: string, to: Channel) {
    try {
      await moveVoiceUser(client(), userId, to);
    } catch (err) {
      console.error("[voice] could not move user", err);
      snackbar.show({
        message: t`Couldn't move them to ${to.name}.`,
      });
    }
  };
}
