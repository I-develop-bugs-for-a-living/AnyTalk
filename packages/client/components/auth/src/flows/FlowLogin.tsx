import {
  Match,
  Show,
  Switch,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import { useClientLifecycle } from "@revolt/client";
import { State, TransitionType } from "@revolt/client/Controller";
import {
  type PasskeyChallenge,
  PasskeyApiError,
  getPasskeyCredential,
  isUnsupportedByServer,
  passkeysSupportedByBrowser,
} from "@revolt/client/passkeyApi";
import {
  isConditionalMediationAvailable,
  isPromptCancelled,
} from "@revolt/client/webauthn";
import { useModals } from "@revolt/modal";
import { Navigate, useNavigate } from "@revolt/routing";
import {
  Button,
  CircularProgress,
  Column,
  Row,
  Symbol,
  Text,
  iconSize,
} from "@revolt/ui";

import MdArrowBack from "@material-design-icons/svg/filled/arrow_back.svg?component-solid";
import MdError from "@material-design-icons/svg/filled/error.svg?component-solid";

import { useState } from "@revolt/state";
import { FlowTitle } from "./Flow";
import { ErrorContainer, Fields, Form } from "./Form";

/**
 * How often the prepared passkey challenge is replaced (the server keeps one
 * for 120 seconds)
 */
const CHALLENGE_REFRESH_MS = 90_000;

/** Age after which a prepared challenge is too close to the server's limit */
const CHALLENGE_STALE_MS = 100_000;

/**
 * Flow for logging into an account
 */
export default function FlowLogin() {
  const state = useState();
  const navigate = useNavigate();
  const modals = useModals();
  const controller = useClientLifecycle();
  const { lifecycle, isLoggedIn, login, selectUsername } = controller;
  const { t } = useLingui();

  // Passkey sign-in. The button only shows once the server answered a
  // challenge request, so servers without passkeys never see it.
  const [passkeyAvailable, setPasskeyAvailable] = createSignal(false);
  const [passkeyBusy, setPasskeyBusy] = createSignal(false);
  const [passkeyError, setPasskeyError] = createSignal<string>();

  // One prepared challenge serves both the autofill (conditional) request and
  // the button: aborting a request does not spend the challenge on the server,
  // so the button can ask the browser again with the same options. Safari only
  // allows the prompt right after a tap, so the click must not wait on the
  // network either.
  let challenge: PasskeyChallenge | undefined;
  // when `challenge` was fetched, to spot one that went stale in the background
  let challengeAt = 0;
  let conditionalAbort: AbortController | undefined;
  let conditionalSupported: boolean | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  // increases with every new flow, so an older one can tell it is stale
  let flow = 0;
  let unsupportedByServer = false;
  let retriesLeft = 1;
  let disposed = false;

  /**
   * Readable text for a failed passkey sign-in
   * @param err Error from the browser or the server
   */
  function describePasskeyError(err: unknown): string {
    const status = err instanceof PasskeyApiError ? err.status : 0;
    if (status === 401) {
      return t`That passkey was not accepted. Try again or sign in another way.`;
    }
    if (status === 429) {
      return t`Too many attempts. Wait a moment and try again.`;
    }
    return t`Couldn't sign in with a passkey. Try again or sign in another way.`;
  }

  /** Stop the pending autofill request, if any */
  function stopConditional() {
    conditionalAbort?.abort();
    conditionalAbort = undefined;
  }

  /**
   * Fetch a fresh challenge, show the button and offer autofill with it.
   * Hides everything if the server has no passkeys or can't be reached.
   */
  async function arm() {
    if (disposed || unsupportedByServer) return;
    stopConditional();
    clearTimeout(refreshTimer);
    const id = ++flow;

    let next: PasskeyChallenge;
    try {
      next = await controller.startPasskeyLogin();
    } catch (err) {
      if (disposed || id !== flow) return;
      challenge = undefined;
      setPasskeyAvailable(false);
      // drop a stale message such as "request renewed"
      setPasskeyError(undefined);
      // 404/405: no passkeys on this server, never ask again. Anything else
      // (offline, rate limit) may get one more try when the email gets focus.
      if (isUnsupportedByServer(err)) unsupportedByServer = true;
      return;
    }
    if (disposed || id !== flow) return;

    challenge = next;
    challengeAt = Date.now();
    setPasskeyAvailable(true);
    refreshTimer = setTimeout(refresh, CHALLENGE_REFRESH_MS);
    startConditional(next);
  }

  /** Replace the prepared challenge, unless a sign-in is running right now */
  function refresh() {
    if (disposed) return;
    if (passkeyBusy()) {
      refreshTimer = setTimeout(refresh, 10_000);
      return;
    }
    arm();
  }

  /**
   * Let the browser offer passkeys in the email field's autofill list. Picking
   * one signs in. This runs in the background, so it never shows errors.
   * @param prepared Challenge to use
   */
  async function startConditional(prepared: PasskeyChallenge) {
    if (!conditionalSupported || disposed) return;
    stopConditional();
    const abort = new AbortController();
    conditionalAbort = abort;
    const id = ++flow;
    // aborted or replaced flows must not touch the shared state
    const isCurrent = () => id === flow && !abort.signal.aborted && !disposed;

    let finishing = false;
    try {
      const credential = await getPasskeyCredential(prepared.options, {
        mediation: "conditional",
        signal: abort.signal,
      });
      if (!credential || !isCurrent()) return;

      finishing = true;
      setPasskeyBusy(true);
      setPasskeyError(undefined);
      await controller.finishPasskeyLogin(prepared.challenge_id, credential);
    } catch (err) {
      if (!isCurrent()) return;
      if (!isPromptCancelled(err)) console.error("Passkey autofill:", err);
      if (finishing) {
        // the challenge is spent: prepare a new one
        setPasskeyBusy(false);
        arm();
      }
    }
  }

  /**
   * Timers are throttled in background tabs and on a locked phone, so the
   * challenge may have gone stale meanwhile: renew it when the page is shown
   */
  function onVisibilityChange() {
    if (
      document.visibilityState === "visible" &&
      !disposed &&
      !unsupportedByServer &&
      challenge &&
      Date.now() - challengeAt >= CHALLENGE_REFRESH_MS
    ) {
      refresh();
    }
  }

  /**
   * One more try after a network error or rate limit, when the user shows
   * interest in the sign-in form
   * @param event Focus event from anywhere in the page
   */
  function onFocusIn(event: FocusEvent) {
    const target = event.target as HTMLElement | null;
    if (
      !disposed &&
      !passkeyAvailable() &&
      !unsupportedByServer &&
      retriesLeft > 0 &&
      target?.matches?.('input[name="email"]')
    ) {
      retriesLeft--;
      arm();
    }
  }

  onMount(async () => {
    if (!passkeysSupportedByBrowser()) return;
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    conditionalSupported = await isConditionalMediationAvailable();
    if (disposed) return;
    await arm();
  });

  onCleanup(() => {
    disposed = true;
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    clearTimeout(refreshTimer);
    stopConditional();
  });

  /** Sign in with a passkey, from the button */
  async function signInWithPasskey() {
    if (passkeyBusy() || !challenge) return;
    if (Date.now() - challengeAt >= CHALLENGE_STALE_MS) {
      // too old for the server: fetching a new one here would use up the tap
      // (Safari), so renew it and ask for another tap instead of failing
      setPasskeyError(
        t`The passkey request was renewed. Choose Sign in with a passkey once more.`,
      );
      arm();
      return;
    }
    const prepared = challenge;
    // only one passkey request may be pending at a time
    stopConditional();
    const id = ++flow;
    setPasskeyBusy(true);
    setPasskeyError(undefined);

    let finishing = false;
    try {
      const credential = await getPasskeyCredential(prepared.options);
      if (!credential) throw new DOMException("No credential", "AbortError");

      finishing = true;
      await controller.finishPasskeyLogin(prepared.challenge_id, credential);
    } catch (err) {
      if (disposed || id !== flow) return;
      if (!isPromptCancelled(err)) setPasskeyError(describePasskeyError(err));
      setPasskeyBusy(false);
      if (finishing) {
        // the challenge is spent: prepare a new one
        arm();
      } else {
        // not spent: offer autofill again with the same one
        startConditional(prepared);
      }
    }
  }

  /**
   * Log into account
   * @param data Form Data
   */
  async function performLogin(data: FormData) {
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    if (!email || !password) return;

    await login(
      {
        email,
        password,
      },
      modals,
    );
  }

  /**
   * Select a new username
   * @param data Form Data
   */
  async function select(data: FormData) {
    const username = data.get("username") as string;
    await selectUsername(username);
  }

  return (
    <>
      <Switch
        fallback={
          <>
            <FlowTitle subtitle={<Trans>Sign into AnyTalk</Trans>} emoji="wave">
              <Trans>Welcome!</Trans>
            </FlowTitle>
            <Form onSubmit={performLogin}>
              <Fields
                fields={[
                  // lets the browser offer passkeys in this field
                  { field: "email", autocomplete: "username webauthn" },
                  "password",
                ]}
              />
              <Column gap="md" align>
                <Show when={passkeyAvailable()}>
                  {/* button and its error belong together: one gap slot */}
                  <Column gap="sm" align>
                    <Button
                      variant="tonal"
                      isDisabled={passkeyBusy()}
                      onPress={signInWithPasskey}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          "align-items": "center",
                          gap: "8px",
                        }}
                      >
                        <Symbol>passkey</Symbol>
                        <Trans>Sign in with a passkey</Trans>
                      </span>
                    </Button>
                    {/* always rendered so screen readers announce what appears */}
                    <div role="alert">
                      <Show when={passkeyError()}>
                        <ErrorContainer>
                          <MdError
                            {...iconSize("1rem")}
                            fill="currentColor"
                            style={{ "flex-shrink": 0 }}
                          />
                          <Text class="label" size="small">
                            {passkeyError()}
                          </Text>
                        </ErrorContainer>
                      </Show>
                    </div>
                  </Column>
                </Show>
                <Button variant="tonal" onPress={() => navigate("/login/qr")}>
                  <Trans>Log in with QR code</Trans>
                </Button>
                <a href="/login/reset">
                  <Button variant="text">
                    <Trans>Reset password</Trans>
                  </Button>
                </a>
                <a href="/login/resend">
                  <Button variant="text">
                    <Trans>Resend verification</Trans>
                  </Button>
                </a>
              </Column>
              <Row align justify>
                <a href="..">
                  <Button variant="text">
                    <MdArrowBack class="rtl-mirror" {...iconSize("1.2em")} />{" "}
                    <Trans>Back</Trans>
                  </Button>
                </a>
                <Button type="submit">
                  <Trans>Login</Trans>
                </Button>
              </Row>
            </Form>
          </>
        }
      >
        <Match when={isLoggedIn()}>
          <Navigate href={state.layout.popNextPath() ?? "/app"} />
        </Match>
        <Match when={lifecycle.state() === State.LoggingIn}>
          <CircularProgress />
        </Match>
        <Match when={lifecycle.state() === State.Onboarding}>
          <FlowTitle>
            <Trans>Choose a username</Trans>
          </FlowTitle>

          <Text>
            <Trans>
              Pick a username that you want people to be able to find you by.
              This can be changed later in your user settings.
            </Trans>
          </Text>

          <Form onSubmit={select}>
            <Fields fields={["username"]} />
            <Row align justify>
              <Button
                variant="text"
                onPress={() =>
                  lifecycle.transition({
                    type: TransitionType.Cancel,
                  })
                }
              >
                <MdArrowBack class="rtl-mirror" {...iconSize("1.2em")} />{" "}
                <Trans>Cancel</Trans>
              </Button>
              <Button type="submit">
                <Trans>Confirm</Trans>
              </Button>
            </Row>
          </Form>
        </Match>
      </Switch>
    </>
  );
}
