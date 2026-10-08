import { Trans } from "@lingui/solid/macro";
import { Component, Match, Show, Switch, createMemo } from "solid-js";

import { Channel } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { Navigate, useParams } from "@revolt/routing";

import { AgeGate } from "./AgeGate";
import { TextChannel } from "./text/TextChannel";

/**
 * Channel layout
 */
const Base = styled("div", {
  base: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    position: "relative",
    flexDirection: "column",
  },
});

export interface ChannelPageProps {
  channel: Channel;
}

const TEXT_CHANNEL_TYPES: Channel["type"][] = [
  "TextChannel",
  "DirectMessage",
  "Group",
  "SavedMessages",
];

/**
 * Channel component
 */
export const ChannelPage: Component = () => {
  const params = useParams();
  const client = useClient();
  const channel = createMemo<Channel | undefined>(() =>
    client()?.channels.get(params.channel),
  );

  return (
    <Base>
      <Switch fallback={<Trans>Unknown channel type!</Trans>}>
        <Match when={!channel()}>
          <Navigate href={"../.."} />
        </Match>
        <Match
          when={!!channel() && TEXT_CHANNEL_TYPES.includes(channel()!.type)}
        >
          {/* Not keyed, so TextChannel stays mounted across channel switches */}
          <Show when={channel()}>
            {(ch) => (
              <AgeGate
                enabled={!!ch().mature}
                contentId={ch().id}
                contentName={"#" + ch().name}
                contentType="channel"
              >
                <TextChannel channel={ch()} />
              </AgeGate>
            )}
          </Show>
        </Match>
        {/* <Match when={channel()!.type === "VoiceChannel"}>
            <Header placement="primary">
              <ChannelHeader channel={channel()} />
            </Header>
          </Match> */}
      </Switch>
    </Base>
  );
};
