import { createSignal } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import { css } from "styled-system/css";

import { Button, Row } from "@revolt/ui";

/** Where a message search looks: the open channel or its whole server */
export type SearchScope = "channel" | "server";

/**
 * Scope chosen for message search, shared by the header search box and the
 * results panel so both stay in sync. It is a preference, so it persists
 * while moving between channels (DMs and groups ignore it).
 */
export const [searchScope, setSearchScope] =
  createSignal<SearchScope>("channel");

/** Keeps the connected buttons at least 44px tall on phones */
const touchTargets = css({ _phone: { "& button": { minHeight: "44px" } } });

/**
 * "This channel" / "Whole server" switch for message search
 */
export function SearchScopeSwitch() {
  const { t } = useLingui();

  return (
    <div role="group" aria-label={t`Search scope`} class={touchTargets}>
      <Row justify="stretch">
        <Button
          group="connected-start"
          groupActive={searchScope() === "channel"}
          aria-pressed={searchScope() === "channel"}
          onPress={() => setSearchScope("channel")}
        >
          <Trans>This channel</Trans>
        </Button>
        <Button
          group="connected-end"
          groupActive={searchScope() === "server"}
          aria-pressed={searchScope() === "server"}
          onPress={() => setSearchScope("server")}
        >
          <Trans>Whole server</Trans>
        </Button>
      </Row>
    </div>
  );
}
