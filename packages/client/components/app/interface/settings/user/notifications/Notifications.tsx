import { Trans, useLingui } from "@lingui/solid/macro";
import { Show } from "solid-js";

import { useNotifications } from "@revolt/client";
import { useState } from "@revolt/state";
import type { NotificationState } from "@revolt/state/stores/NotificationOptions";
import {
  CategoryButton,
  Checkbox,
  Column,
  Radio2,
  Text,
  iconSize,
} from "@revolt/ui";

import MdMarkUnreadChatAlt from "@material-design-icons/svg/outlined/mark_unread_chat_alt.svg?component-solid";
import MdNotifications from "@material-design-icons/svg/outlined/notifications.svg?component-solid";
import Sounds from "./Sounds";

/**
 * Notifications Page
 */
export default function Notifications(props: { isDesktop: boolean }) {
  const { settings, notifications } = useState();
  const { t } = useLingui();

  const { toggleNotificationPermission, togglePushPermission } =
    useNotifications();

  return (
    <Column gap="lg">
      <Column>
        <CategoryButton.Group>
          <Show when={settings.desktopNotificationsState !== "unsupported"}>
            <CategoryButton
              action={
                <Checkbox
                  checked={settings.desktopNotificationsState === "allowed"}
                />
              }
              onClick={() => toggleNotificationPermission(true)}
              icon={<MdNotifications {...iconSize(22)} />}
              description={
                props.isDesktop ? (
                  <Trans>
                    Receive notifications while the app is open and in the
                    background.
                  </Trans>
                ) : (
                  <Trans>Receive notifications while the tab is open.</Trans>
                )
              }
            >
              <Trans>Enable Desktop Notifications</Trans>
            </CategoryButton>
          </Show>
          <Show when={!props.isDesktop}>
            <CategoryButton
              action={
                <Checkbox
                  checked={settings.pushNotificationsState === "allowed"}
                />
              }
              onClick={() => togglePushPermission(true)}
              icon={<MdMarkUnreadChatAlt {...iconSize(22)} />}
              description={
                <Trans>
                  Receive push notifications while the app is closed.
                </Trans>
              }
            >
              <Trans>Enable Push Notifications</Trans>
            </CategoryButton>
          </Show>
        </CategoryButton.Group>
      </Column>
      <Column>
        <Text class="title">
          <Trans>Default notifications for new servers</Trans>
        </Text>
        <Text class="label">
          <Trans>
            Applies to servers you join or create from now on. Existing servers
            keep their level.
          </Trans>
        </Text>
        <Radio2
          aria-label={t`Default notifications for new servers`}
          value={notifications.get().default_server}
          onChange={(event) =>
            notifications.setDefaultServer(
              event.currentTarget.value as NotificationState,
            )
          }
        >
          <Radio2.Option value="all">
            <Trans>All messages</Trans>
          </Radio2.Option>
          <Radio2.Option value="mention">
            <Trans>Mentions only</Trans>
          </Radio2.Option>
          <Radio2.Option value="none">
            <Trans>Nothing</Trans>
          </Radio2.Option>
        </Radio2>
      </Column>
      <Sounds />
    </Column>
  );
}
