import { createFormControl, createFormGroup } from "solid-forms";
import { BiRegularArchive, BiSolidKey, BiSolidKeyboard } from "solid-icons/bi";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import type { API } from "stoat.js";

import { useClient } from "@revolt/client";
import {
  type PasskeyChallenge,
  PasskeyApiError,
  answerWithChallenge,
  fetchMfaStatus,
  startWebAuthnMfa,
} from "@revolt/client/passkeyApi";
import { isPromptCancelled } from "@revolt/client/webauthn";
import {
  CategoryButton,
  CircularProgress,
  Column,
  Dialog,
  DialogProps,
  Form2,
  Symbol,
  Text,
} from "@revolt/ui";

import { useModals } from "..";
import { Modals } from "../types";

/**
 * Method list of the modal: the API's methods plus passkeys, which stoat.js's
 * type does not know about
 */
type Method = API.MFAMethod | "WebAuthn";

/**
 * Modal to create an MFA ticket
 */
export function MFAFlowModal(
  props: DialogProps & Modals & { type: "mfa_flow" },
) {
  const { t } = useLingui();
  const { showError } = useModals();
  const client = useClient();

  // Keep track of available methods
  const [methods, setMethods] = createSignal<Method[] | undefined>(
    // eslint-disable-next-line solid/reactivity
    props.state === "unknown" ? props.available_methods : undefined,
  );

  // Current state of the modal
  const [selectedMethod, setSelected] = createSignal<Method>();

  const group = createFormGroup({
    password: createFormControl(""),
    totp_code: createFormControl(""),
    recovery_code: createFormControl(""),
  });

  // Set when the modal is gone, so late answers are ignored
  let unmounted = false;
  onCleanup(() => {
    unmounted = true;
  });

  // Passkey challenge fetched as soon as the passkey method is picked, so
  // Confirm only has to open the browser prompt (Safari needs that)
  let passkeyChallenge: { challenge: PasskeyChallenge; at: number } | undefined;

  /**
   * API and login ticket to ask for a passkey challenge with. While logging in
   * there is no session yet, so the caller passes its own unauthenticated `api`
   * and the login `ticket`; with a session, the logged-in client is used.
   */
  const passkeyApi = () =>
    props.state === "unknown" ? (props.api ?? client().api) : client().api;
  const passkeyTicket = () =>
    props.state === "unknown" ? props.ticket : undefined;

  /** Fetch a challenge ahead of Confirm; failures are retried on Confirm */
  async function prefetchPasskey() {
    passkeyChallenge = undefined;
    try {
      const challenge = await startWebAuthnMfa(passkeyApi(), passkeyTicket());
      // ignore the answer if the user moved on meanwhile
      if (unmounted || selectedMethod() !== "WebAuthn") return;
      passkeyChallenge = { challenge, at: Date.now() };
    } catch {
      // Confirm fetches one itself
    }
  }

  // True while the challenge for the "tap again" step is being fetched
  let fetching = false;

  // Set when a challenge had to be fetched on Confirm, so the user taps again
  const [tapAgain, setTapAgain] = createSignal(false);

  createEffect(() => {
    setTapAgain(false);
    if (selectedMethod() === "WebAuthn") prefetchPasskey();
  });

  // Fetch available methods if they have not been provided.
  onMount(async () => {
    if (!methods() && props.state === "known") {
      // stoat.js only knows about the authenticator app, so ask the server
      // for the full status to find out whether passkeys are on too
      try {
        const status = await fetchMfaStatus(client().api);
        if (unmounted) return;
        const list: Method[] = [];
        if (status.totp_mfa) list.push("Totp");
        if (status.security_key_mfa) list.push("WebAuthn");
        if (list.length === 0) list.push("Password");
        else if (status.recovery_active) list.push("Recovery");
        setMethods(list);
      } catch {
        if (!unmounted) setMethods(props.mfa.availableMethods);
      }
    }
  });

  // Always select first available method if only one available.
  createEffect(() => {
    const list = methods();
    if (list) {
      setSelected(list.find((entry) => entry !== "Recovery"));
    }
  });

  /**
   * Callback to generate a new ticket or send response back up the chain
   */
  async function onSubmit() {
    // ignore taps while the "tap again" challenge is still being fetched
    if (fetching) return;
    try {
      const method = selectedMethod();
      if (!method) return;

      let mfa_response: API.MFAResponse;

      switch (method) {
        case "Password":
          mfa_response = { password: group.controls.password.value };
          break;
        case "Totp":
          mfa_response = { totp_code: group.controls.totp_code.value };
          break;
        case "Recovery":
          mfa_response = { recovery_code: group.controls.recovery_code.value };
          break;
        case "WebAuthn": {
          // the browser asks for the passkey; no form field involved
          let answer;
          // use the prefetched challenge (a server keeps it for 120 s)
          const stored =
            passkeyChallenge && Date.now() - passkeyChallenge.at < 100_000
              ? passkeyChallenge
              : undefined;
          if (!stored) {
            // Safari only opens the passkey prompt straight from a tap, and
            // the fetch below uses that up. So fetch now, keep the challenge
            // and ask for one more tap instead of failing silently.
            passkeyChallenge = undefined;
            fetching = true;
            let challenge;
            try {
              challenge = await startWebAuthnMfa(passkeyApi(), passkeyTicket());
            } finally {
              fetching = false;
            }
            if (unmounted) return;
            passkeyChallenge = { challenge, at: Date.now() };
            setTapAgain(true);
            return;
          }
          setTapAgain(false);
          passkeyChallenge = undefined;
          try {
            // no await before this call: the tap must reach the browser
            answer = await answerWithChallenge(stored.challenge);
          } catch (error) {
            // a dismissed prompt just leaves the dialog open; the challenge
            // is not spent by that, so keep it
            if (isPromptCancelled(error)) {
              passkeyChallenge = stored;
              return;
            }
            if (error instanceof PasskeyApiError) {
              showError(error);
              return;
            }
            throw error;
          }
          if (!answer) return;
          mfa_response = answer as unknown as API.MFAResponse;
          break;
        }
        default:
          return;
      }

      if (props.state === "known") {
        const ticket = await props.mfa.createTicket(mfa_response);
        props.callback(ticket);
      } else {
        props.callback(mfa_response);
      }

      props.onClose();
    } catch (error) {
      showError(error);
      // a failed attempt spent the challenge: get a new one
      if (selectedMethod() === "WebAuthn") prefetchPasskey();
    }
  }

  function onCancel() {
    props.callback();
    props.onClose();
  }

  function onBack() {
    if (methods()!.length === 1) {
      onCancel();
    } else {
      setSelected(undefined);

      // Clear form values
      group.controls.password.setValue("");
      group.controls.totp_code.setValue("");
      group.controls.recovery_code.setValue("");
    }
  }

  function canSubmit() {
    if (selectedMethod() === "WebAuthn") return true;
    return (
      Form2.canSubmit(group) &&
      (group.controls.password.value ||
        group.controls.totp_code.value ||
        group.controls.recovery_code.value)
    );
  }

  const getActions = () => {
    if (selectedMethod()) {
      return [
        {
          text: (
            <Switch fallback={<Trans>Back</Trans>}>
              <Match when={methods()!.length === 1}>
                <Trans>Cancel</Trans>
              </Match>
            </Switch>
          ),
          onClick: () => {
            onBack();
            return false;
          },
        },
        {
          text: <Trans>Confirm</Trans>,
          onClick: () => {
            onSubmit();
            return false;
          },
          isDisabled: !canSubmit(),
        },
      ];
    }

    return [
      {
        text: <Trans>Cancel</Trans>,
        onClick: () => {
          onCancel();
          return false;
        },
      },
    ];
  };

  const submit = Form2.useSubmitHandler(group, onSubmit);

  return (
    <Dialog
      show={props.show}
      onClose={() =>
        props.state === "unknown" || selectedMethod() ? undefined : onCancel()
      }
      title={<Trans>Confirm action</Trans>}
      actions={getActions()}
      isDisabled={group.isPending}
    >
      <form onSubmit={submit}>
        <Column>
          <Text>
            <Switch
              fallback={
                <Trans>
                  Please select a method to authenticate your request.
                </Trans>
              }
            >
              <Match when={selectedMethod()}>
                <Trans>
                  Please confirm this action using the selected method.
                </Trans>
              </Match>
            </Switch>
          </Text>

          <Switch fallback={<CircularProgress />}>
            <Match when={selectedMethod()}>
              <Switch>
                <Match when={selectedMethod() === "Password"}>
                  <Form2.TextField
                    name="password"
                    control={group.controls.password}
                    type="password"
                    label={t`Password`}
                  />
                </Match>
                <Match when={selectedMethod() === "Totp"}>
                  <Form2.TextField
                    name="totp_code"
                    control={group.controls.totp_code}
                    type="text"
                    label={t`Authenticator App`}
                  />
                </Match>
                <Match when={selectedMethod() === "Recovery"}>
                  <Form2.TextField
                    name="recovery_code"
                    control={group.controls.recovery_code}
                    type="text"
                    label={t`Recovery Code`}
                  />
                </Match>
                <Match when={selectedMethod() === "WebAuthn"}>
                  <Text>
                    <Trans>
                      Choose Confirm, then approve with your passkey when your
                      device asks.
                    </Trans>
                  </Text>
                  <Show when={tapAgain()}>
                    <div role="status">
                      <Text>
                        <Trans>
                          The passkey request is ready. Choose Confirm once
                          more.
                        </Trans>
                      </Text>
                    </div>
                  </Show>
                </Match>
              </Switch>
            </Match>
            <Match when={methods()}>
              <For each={methods()}>
                {(method) => (
                  <CategoryButton
                    action="chevron"
                    icon={
                      <Switch>
                        <Match when={method === "Password"}>
                          <BiSolidKeyboard size={24} />
                        </Match>
                        <Match when={method === "Totp"}>
                          <BiSolidKey size={24} />
                        </Match>
                        <Match when={method === "Recovery"}>
                          <BiRegularArchive size={24} />
                        </Match>
                        <Match when={method === "WebAuthn"}>
                          <Symbol>passkey</Symbol>
                        </Match>
                      </Switch>
                    }
                    onClick={() => {
                      setSelected(method);
                      // Clear form values when switching methods
                      group.controls.password.setValue("");
                      group.controls.totp_code.setValue("");
                      group.controls.recovery_code.setValue("");
                    }}
                  >
                    <Switch>
                      <Match when={method === "Password"}>
                        <Trans>Password</Trans>
                      </Match>
                      <Match when={method === "Totp"}>
                        <Trans>Authenticator App</Trans>
                      </Match>
                      <Match when={method === "Recovery"}>
                        <Trans>Recovery Code</Trans>
                      </Match>
                      <Match when={method === "WebAuthn"}>
                        <Trans>Passkey</Trans>
                      </Match>
                    </Switch>
                  </CategoryButton>
                )}
              </For>
            </Match>
          </Switch>
        </Column>
      </form>
    </Dialog>
  );
}
