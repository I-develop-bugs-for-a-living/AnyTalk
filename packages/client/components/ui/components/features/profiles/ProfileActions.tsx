import { Show, createResource } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { useNavigate } from "@solidjs/router";
import { PublicBot, ServerMember, User } from "stoat.js";
import { styled } from "styled-system/jsx";

import { UserContextMenu } from "@revolt/app";
import { useClient } from "@revolt/client";
import { useModals } from "@revolt/modal";

import MdCancel from "@material-design-icons/svg/filled/cancel.svg?component-solid";
import MdEdit from "@material-design-icons/svg/filled/edit.svg?component-solid";
import MdMoreVert from "@material-design-icons/svg/filled/more_vert.svg?component-solid";

import { Button, IconButton } from "../../design";
import { iconSize } from "../../utils";

/**
 * Actions shown on profile cards and on the phone profile page.
 *
 * The `page` variant is for the phone page: buttons wrap, the main action is
 * filled, the others tonal, and the edit and menu icons are left out (the
 * page has its own menu button and an "Edit profile" button).
 */
export function ProfileActions(props: {
  /** Grid span for the card variant */
  width?: 2 | 3;
  /** Layout variant, defaults to the card */
  variant?: "card" | "page";

  user: User;
  member?: ServerMember;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const client = useClient();
  const { openModal } = useModals();

  const [publicBot] = createResource(
    () => props.user.bot && props.user.id,
    (id) =>
      client()
        .bots.fetchPublic(id)
        .then((b) => (b instanceof PublicBot ? b : new PublicBot(client(), b)))
        .catch(() => {}),
  );

  /**
   * Open direct message channel
   */
  function openDm() {
    props.user.openDM().then((channel) => navigate(channel.path));
    props.onClose();
  }

  /**
   * Open edit menu
   */
  function openEdit() {
    openModal(
      props.member
        ? { type: "server_identity", member: props.member }
        : { type: "settings", config: "user" },
    );
    if (!props.member) props.onClose();
  }

  /**
   * Whether the viewer may edit this profile (own profile, or a server
   * identity they are allowed to change)
   */
  const canEdit = () =>
    props.member
      ? props.user.self
        ? props.member.server!.havePermission("ChangeNickname") ||
          props.member.server!.havePermission("ChangeAvatar")
        : (props.member.server!.havePermission("ManageNicknames") ||
            props.member.server!.havePermission("RemoveAvatars")) &&
          props.member.inferiorTo(props.member!.server!.member!)
      : props.user.self;

  const page = () => props.variant === "page";

  return (
    <Actions width={props.width} page={page()}>
      <Show when={props.user.relationship === "None" && !props.user.bot}>
        <Button
          variant={page() ? "tonal" : undefined}
          onPress={() => props.user.addFriend()}
        >
          <Trans>Add Friend</Trans>
        </Button>
      </Show>
      <Show when={props.user.relationship === "Incoming"}>
        <Button
          variant={page() ? "tonal" : undefined}
          onPress={() => props.user.addFriend()}
        >
          <Trans>Accept friend request</Trans>
        </Button>
        <IconButton
          aria-label={t`Decline friend request`}
          onPress={() => props.user.removeFriend()}
        >
          <MdCancel />
        </IconButton>
      </Show>
      <Show when={props.user.relationship === "Outgoing"}>
        <Button
          variant={page() ? "tonal" : undefined}
          onPress={() => props.user.removeFriend()}
        >
          <Trans>Cancel friend request</Trans>
        </Button>
      </Show>
      <Show when={props.user.relationship === "Friend"}>
        <Button onPress={openDm}>
          <Trans>Message</Trans>
        </Button>
      </Show>
      <Show when={publicBot()}>
        <Button
          onPress={() =>
            openModal({
              type: "add_bot",
              invite: publicBot()!,
            })
          }
        >
          <Trans>Add Bot</Trans>
        </Button>
      </Show>

      <Show when={canEdit()}>
        <Show
          when={page()}
          fallback={
            <IconButton aria-label={t`Edit profile`} onPress={openEdit}>
              <MdEdit {...iconSize(16)} />
            </IconButton>
          }
        >
          <Button onPress={openEdit}>
            <Trans>Edit profile</Trans>
          </Button>
        </Show>
      </Show>

      <Show when={!page()}>
        <IconButton
          use:floating={{
            contextMenu: () => (
              <UserContextMenu
                user={props.user}
                member={props.member}
                onClose={props.onClose}
              />
            ),
            contextMenuHandler: "click",
          }}
        >
          <MdMoreVert />
        </IconButton>
      </Show>
    </Actions>
  );
}

const Actions = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-md)",
    justifyContent: "flex-end",
  },
  variants: {
    width: {
      3: {
        gridColumn: "1 / 4",
      },
      2: {
        gridColumn: "1 / 3",
      },
    },
    page: {
      true: {
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-start",
      },
    },
  },
});
