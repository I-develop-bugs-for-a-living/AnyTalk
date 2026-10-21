import type { Channel } from "stoat.js";

import { ChannelContextMenu } from "./ChannelContextMenu";
import { UserContextMenu } from "./UserContextMenu";

/**
 * Context menu for a DM or group DM. Used by the Home sidebar list and the
 * pinned conversations on the server rail, so both offer the same entries.
 * Direct messages use the user menu, groups use the channel menu.
 */
export function ConversationContextMenu(props: { channel: Channel }) {
  return (
    <>
      {props.channel.type === "DirectMessage" && props.channel.recipient ? (
        <UserContextMenu
          user={props.channel.recipient}
          channel={props.channel}
        />
      ) : (
        <ChannelContextMenu channel={props.channel} />
      )}
    </>
  );
}
