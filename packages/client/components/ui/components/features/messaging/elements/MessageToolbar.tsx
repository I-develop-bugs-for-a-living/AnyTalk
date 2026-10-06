import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { MessageContextMenu, useMessage } from "@revolt/app";
import { useUser } from "@revolt/client";
import { useModals } from "@revolt/modal";
import { useState } from "@revolt/state";
import { Ripple } from "@revolt/ui/components/design";
import { iconSize } from "@revolt/ui/components/utils";

import MdDelete from "@material-design-icons/svg/outlined/delete.svg?component-solid";
import MdEdit from "@material-design-icons/svg/outlined/edit.svg?component-solid";
import MdEmojiEmotions from "@material-design-icons/svg/outlined/emoji_emotions.svg?component-solid";
import MdMoreVert from "@material-design-icons/svg/outlined/more_vert.svg?component-solid";
import MdReply from "@material-design-icons/svg/outlined/reply.svg?component-solid";

export function MessageToolbar() {
  const user = useUser();
  const state = useState();
  const { openModal } = useModals();
  const { message, reactPicker } = useMessage();
  const { t } = useLingui();

  let reactRef;

  /**
   * Delete the message
   */
  function deleteMessage(ev: MouseEvent) {
    if (ev.shiftKey) {
      message?.delete();
    } else if (message) {
      openModal({
        type: "delete_message",
        message: message,
      });
    }
  }

  return (
    <Base class="Toolbar">
      <Show when={message?.channel?.havePermission("SendMessage")}>
        <button
          type="button"
          class={tool()}
          aria-label={t`Reply`}
          onClick={() => state.draft.addReply(message!, user()!.id)}
        >
          <Ripple />
          <MdReply class="rtl-mirror" {...iconSize(20)} />
        </button>
      </Show>
      <Show when={message?.channel?.havePermission("React")}>
        <button
          type="button"
          ref={reactRef}
          class={tool()}
          aria-label={t`Add reaction`}
          onClick={(e) => reactPicker!()?.onClickEmoji(e, reactRef)}
        >
          <Ripple />
          <MdEmojiEmotions {...iconSize(20)} />
        </button>
      </Show>
      <Show when={message?.author?.self}>
        <button
          type="button"
          class={tool()}
          aria-label={t`Edit message`}
          onClick={() => state.draft.setEditingMessage(message)}
        >
          <Ripple />
          <MdEdit {...iconSize(20)} />
        </button>
      </Show>
      <Show
        when={
          message?.author?.self ||
          message?.channel?.havePermission("ManageMessages")
        }
      >
        <button
          type="button"
          class={tool()}
          aria-label={t`Delete message`}
          onClick={deleteMessage}
        >
          <Ripple />
          <MdDelete {...iconSize(20)} />
        </button>
      </Show>
      <button
        type="button"
        class={tool()}
        aria-label={t`More options`}
        aria-haspopup="menu"
        use:floating={{
          contextMenu: () => (
            <MessageContextMenu message={message!} reactPicker={reactPicker} />
          ),
          contextMenuHandler: "click",
        }}
      >
        <Ripple />
        <MdMoreVert {...iconSize(20)} />
      </button>
    </Base>
  );
}

const Base = styled("div", {
  base: {
    top: "-18px",
    insetInlineEnd: "16px",
    position: "absolute",

    alignItems: "center",

    display: "none",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-xs)",
    boxShadow: "0 0 3px var(--md-sys-color-shadow)",

    fill: "var(--md-sys-color-on-secondary-container)",
    background: "var(--md-sys-color-secondary-container)",
  },
});

const tool = cva({
  base: {
    cursor: "pointer",
    position: "relative",
    padding: "var(--gap-sm)",

    // plain button, looks like the old div
    margin: 0,
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});
