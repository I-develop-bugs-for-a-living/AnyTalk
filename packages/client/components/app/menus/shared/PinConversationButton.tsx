import { Show } from "solid-js";

import { Trans } from "@lingui/solid/macro";
import type { Channel } from "stoat.js";

import { useState } from "@revolt/state";

import MdPushPin from "@material-design-icons/svg/outlined/push_pin.svg?component-solid";

import { ContextMenuButton } from "../ContextMenu";

/**
 * Context menu item to pin or unpin a DM or group DM in the Home sidebar
 */
export function PinConversationButton(props: { channel: Channel }) {
  const state = useState();
  const pins = () => state["pinned-conversations"];

  return (
    <Show
      when={pins().isPinned(props.channel.id)}
      fallback={
        <ContextMenuButton
          icon={MdPushPin}
          onClick={() => pins().pin(props.channel.id)}
        >
          <Trans>Pin conversation</Trans>
        </ContextMenuButton>
      }
    >
      <ContextMenuButton
        icon={MdPushPin}
        onClick={() => pins().unpin(props.channel.id)}
      >
        <Trans>Unpin conversation</Trans>
      </ContextMenuButton>
    </Show>
  );
}
