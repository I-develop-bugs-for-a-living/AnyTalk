import { Trans } from "@lingui/solid/macro";
import { For, Show } from "solid-js";

import { useQuery } from "@tanstack/solid-query";
import { ServerMember, User } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useModals } from "@revolt/modal";

import { Avatar, Ripple, Text } from "../../design";

import { ProfileCard } from "./ProfileCard";

/**
 * Mutual friends, servers and group chats shared with a user. Shared by the
 * profile cards and the phone profile page.
 */
export function useMutualsQuery(user: () => User) {
  const client = useClient();

  const query = useQuery(() => ({
    queryKey: ["mutual", user().id],
    queryFn: async () => {
      if (user().self || user().bot) {
        return {
          users: [],
          groups: [],
        };
      }

      const clnt = client();
      const { users, servers } = await user().fetchMutual();

      return {
        users: users.map((userId) => clnt.users.get(userId)!).filter((u) => u),
        groups: [
          ...servers
            .map((serverId) => clnt.servers.get(serverId)!)
            .filter((server) => server),
          ...clnt.channels.filter(
            (channel) =>
              channel.type === "Group" && channel.recipientIds.has(user().id),
          ),
        ],
      };
    },
  }));

  return query;
}

/**
 * Mutual friends and groups cards
 */
export function ProfileMutuals(props: { user: User; member?: ServerMember }) {
  const { openModal } = useModals();

  const query = useMutualsQuery(() => props.user);

  /**
   * Open friends modal
   */
  function openFriends() {
    openModal({
      type: "user_profile_mutual_friends",
      users: query.data!.users,
      server: props.member?.server,
    });
  }

  /**
   * Open groups modal
   */
  function openGroups() {
    openModal({
      type: "user_profile_mutual_groups",
      groups: query.data!.groups,
    });
  }

  return (
    <>
      <Show when={query.data?.users.length}>
        <ProfileCard isLink onClick={openFriends}>
          <Ripple />

          <Text class="title" size="large">
            <Trans>Mutuals</Trans>
          </Text>
          <Grid>
            <For each={query.data?.users}>
              {(user) => (
                <Avatar
                  src={user?.animatedAvatarURL}
                  fallback={user?.displayName}
                  size={20}
                />
              )}
            </For>
          </Grid>
        </ProfileCard>
      </Show>
      <Show when={query.data?.groups.length}>
        <ProfileCard isLink onClick={openGroups}>
          <Ripple />

          <Text class="title" size="large">
            <Trans>Groups</Trans>
          </Text>
          <Grid>
            <For each={query.data?.groups}>
              {(group) => (
                <Avatar
                  src={group.animatedIconURL}
                  fallback={group.name}
                  size={20}
                />
              )}
            </For>
          </Grid>
        </ProfileCard>
      </Show>
    </>
  );
}

const Grid = styled("div", {
  base: {
    gap: "var(--gap-md)",
    display: "flex",
    flexWrap: "wrap",
  },
});
