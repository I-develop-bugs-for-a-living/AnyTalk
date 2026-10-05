import { Trans } from "@lingui/solid/macro";
import { Match, Switch, createSignal, onMount } from "solid-js";

import { useApi } from "@revolt/client";
import { useParams } from "@revolt/routing";

import { FlowTitle } from "./Flow";

/**
 * Temporary flow for account deletion
 */
export default function FlowDeleteAccount() {
  const api = useApi();
  const params = useParams();
  const [deleted, setDeleted] = createSignal<boolean | "error">(false);

  onMount(() => {
    api
      .put("/auth/account/delete", {
        token: params.token,
      })
      .then(() => setDeleted(true))
      .catch(() => setDeleted("error"));
  });

  return (
    <>
      <FlowTitle>
        <Trans>Delete Account</Trans>
      </FlowTitle>
      <span>
        <Switch fallback={<Trans>Please wait...</Trans>}>
          <Match when={deleted() === "error"}>
            <Trans>Error occurred, please email support.</Trans>
          </Match>
          <Match when={deleted() === true}>
            <Trans>Account has been queued for deletion!</Trans>
          </Match>
        </Switch>
      </span>
    </>
  );
}
