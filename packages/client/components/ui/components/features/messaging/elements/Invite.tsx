import { Match, Show, Suspense, Switch } from "solid-js";

import { Plural, Trans } from "@lingui/solid/macro";
import { useNavigate } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { PublicChannelInvite, ServerPublicInvite } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useModals } from "@revolt/modal";
import {
  Avatar,
  Button,
  CircularProgress,
  Text,
} from "@revolt/ui/components/design";
import { Column } from "@revolt/ui/components/layout";

interface Props {
  code: string;
}

export function Invite(props: Props) {
  const client = useClient();
  const navigate = useNavigate();
  const { showError } = useModals();

  const query = useQuery(() => ({
    queryKey: ["invite", props.code],
    queryFn: () =>
      client()
        .api.get(`/invites/${props.code as ""}`)
        .then((invite) => PublicChannelInvite.from(client(), invite)),

    refetchInterval: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }));

  const join = useMutation(() => ({
    mutationFn: () => (query.data as ServerPublicInvite).join(),
    onSuccess(server) {
      navigate(server.path);
    },
    onError: showError,
  }));

  /**
   * Number of members in the invited server, if the invite resolved
   */
  const memberCount = () =>
    query.data instanceof ServerPublicInvite
      ? query.data.memberCount
      : undefined;

  return (
    <Base>
      <Suspense fallback={<CircularProgress />}>
        <Avatar
          size={42}
          src={
            query.data instanceof ServerPublicInvite
              ? query.data.serverIcon?.previewUrl
              : undefined
          }
          fallback={
            query.data instanceof ServerPublicInvite
              ? query.data.serverName
              : undefined
          }
        />
        <Column gap="none" grow>
          <Text class="title" size="small">
            {query.data instanceof ServerPublicInvite
              ? query.data.serverName
              : undefined}
          </Text>
          <Text class="label">
            <Show when={memberCount() !== undefined}>
              <Plural value={memberCount()!} one="# member" other="# members" />
            </Show>
          </Text>
        </Column>
        <Switch
          fallback={
            <Button onPress={() => join.mutate()}>
              <Trans>Join</Trans>
            </Button>
          }
        >
          <Match
            when={
              query.data instanceof ServerPublicInvite &&
              client().servers?.has(query.data.serverId)
            }
          >
            <Button isDisabled>
              <Trans>Joined</Trans>
            </Button>
          </Match>
        </Switch>
      </Suspense>
    </Base>
  );
}

const Base = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",

    maxWidth: "320px",
    height: "64px",
    gap: "var(--gap-md)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",

    color: "var(--md-sys-color-on-secondary-container)",
    background: "var(--md-sys-color-secondary-container)",
  },
});
