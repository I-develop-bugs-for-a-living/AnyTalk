import { For, createMemo } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { createRunningGames, useVoice } from "@revolt/rtc";
import { Button } from "@revolt/ui/components/design";
import { typography } from "@revolt/ui/components/design/Text";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/** Most games offered at once, the footer has little room */
const MAX_GAMES = 3;

/**
 * Offers to stream a game that is running on this computer (desktop app
 * only, it renders nothing elsewhere or when detection is off). Lives in the
 * voice footer, so it only shows during a call. Games that are being
 * streamed already are left out.
 *
 * Desktop only: the bridge it needs exists only in the desktop app, phones
 * and browsers never see it, so it has no phone version.
 */
export function GameStreamPrompt() {
  const voice = useVoice();
  const { t } = useLingui();
  const games = createRunningGames();

  const offered = createMemo(() =>
    games()
      .filter(
        (game) => !(voice.screenshare() && voice.followedGameId() === game.id),
      )
      .slice(0, MAX_GAMES),
  );

  return (
    <List aria-label={t`Running games`}>
      <For each={offered()}>
        {(game) => (
          <Item>
            <Symbol size={20}>sports_esports</Symbol>
            <Name title={game.name}>{game.name}</Name>
            <Button
              size="xs"
              variant="tonal"
              aria-label={t`Stream ${game.name}`}
              onPress={() => voice.startGameStream(game.id)}
            >
              <Trans>Stream</Trans>
            </Button>
          </Item>
        )}
      </For>
    </List>
  );
}

/** Rows of games, collapses to nothing when empty */
const List = styled("ul", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    margin: 0,
    padding: 0,
    listStyle: "none",
    "&:empty": { display: "none" },
  },
});

/** One game with its stream button */
const Item = styled("li", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "32px",
    _phone: { minHeight: "44px" },
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/** Game name, cut off with an ellipsis when long */
const Name = styled("span", {
  base: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    ...typography.raw({ class: "label", size: "medium" }),
    color: "var(--md-sys-color-on-surface)",
  },
});
