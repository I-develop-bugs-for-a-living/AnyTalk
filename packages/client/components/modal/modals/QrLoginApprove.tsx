import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import {
  type PasskeyChallenge,
  answerWithChallenge,
  startWebAuthnMfa,
} from "@revolt/client/passkeyApi";
import {
  type QrApproveProof,
  type QrInfo,
  QrApiError,
  approveQrRequest,
  denyQrRequest,
  describeUserAgent,
  getQrInfo,
  qrApproveOptions,
  shouldDenyOnClose,
} from "@revolt/client/qrApi";
import {
  isPromptCancelled,
  isWebAuthnSupported,
} from "@revolt/client/webauthn";
import {
  Button,
  CircularProgress,
  Column,
  Dialog,
  DialogProps,
  Symbol,
  Text,
  TextField,
  Time,
} from "@revolt/ui";

import { Modals } from "../types";

/**
 * Warning box, announced to screen readers
 */
const Warning = styled("div", {
  base: {
    display: "flex",
    gap: "12px",
    padding: "12px",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-error-container)",
    color: "var(--md-sys-color-on-error-container)",
  },
});

/**
 * Small block of key facts about the request
 */
const Facts = styled("dl", {
  base: {
    margin: 0,
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "4px 12px",
    "& dt": { color: "var(--md-sys-color-on-surface-variant)" },
    "& dd": { margin: 0, overflowWrap: "anywhere" },
  },
});

/** Way of proving ownership in the approve dialog */
type ProofMode = "password" | "code" | "passkey";

/**
 * Modal shown on the logged-in device after scanning a login QR code: shows
 * which device asks to log in, and lets the user approve or deny it.
 */
export function QrLoginApproveModal(
  props: DialogProps & Modals & { type: "qr_login_approve" },
) {
  const { t } = useLingui();
  const client = useClient();

  const [info, setInfo] = createSignal<QrInfo>();
  const [loadError, setLoadError] = createSignal<string>();
  const [code, setCode] = createSignal("");
  const [useRecovery, setUseRecovery] = createSignal<boolean>();
  const [chosenMode, setChosenMode] = createSignal<ProofMode>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  /**
   * Readable text for a failed request
   * @param err Error thrown by the request
   * @param approving Whether the code input was part of the request
   */
  function describe(err: unknown, approving: boolean): string {
    const status = err instanceof QrApiError ? err.status : 0;
    if (status === 404) {
      return t`This login request has expired or was already answered. Ask the other device to show a new QR code.`;
    }
    if (status === 401 && approving) {
      if (mode() === "passkey") {
        return t`That passkey was not accepted. Try again or use another method.`;
      }
      return mode() === "password"
        ? t`That password is not correct. Check it and try again.`
        : t`That code is not correct. Check it and try again.`;
    }
    if (status === 403) {
      return t`Too many wrong codes. Wait a while before trying again.`;
    }
    if (status === 400) {
      // includes InvalidOperation: the request is in the wrong state
      return t`This request cannot be approved right now. Ask the other device to show a new QR code.`;
    }
    if (status === 429) {
      return t`Too many attempts. Wait a moment and try again.`;
    }
    return t`Something went wrong. Check your connection and try again.`;
  }

  // Set once the user approved or denied, so closing does not deny again
  let answered = false;

  let disposed = false;
  onCleanup(() => {
    disposed = true;
    setCode("");
  });

  onMount(async () => {
    try {
      setInfo(await getQrInfo(client().api, props.id));
    } catch (err) {
      setLoadError(describe(err, false));
    }
  });

  /** Proofs the server accepts for this approval */
  const options = createMemo(() => {
    const current = info();
    return current ? qrApproveOptions(current) : undefined;
  });

  /** Whether a passkey can be offered here: server allows it and browser can */
  const passkeyPossible = () => !!options()?.passkey && isWebAuthnSupported();

  /** Whether a typed code can be offered here */
  const codePossible = () => !!options()?.totp || !!options()?.recovery;

  /** Proof the approval needs, if any: the user's choice or the best default */
  const mode = createMemo<ProofMode | undefined>(() => {
    const opts = options();
    if (!opts) return undefined;
    const chosen = chosenMode();
    if (chosen) return chosen;
    if (opts.password) return "password";
    if (passkeyPossible()) return "passkey";
    if (codePossible()) return "code";
    // the server wants a passkey this browser cannot give: show it anyway so
    // the failure is explained instead of offering nothing
    return opts.passkey ? "passkey" : undefined;
  });

  // Passkey challenge fetched as soon as passkey mode shows, so Approve only
  // has to open the browser prompt (Safari needs that)
  let passkeyChallenge: { challenge: PasskeyChallenge; at: number } | undefined;

  /** Fetch a challenge ahead of Approve; failures are retried on Approve */
  async function prefetchPasskey() {
    passkeyChallenge = undefined;
    try {
      const challenge = await startWebAuthnMfa(client().api);
      // ignore the answer if the user moved on or the dialog is gone
      if (disposed || mode() !== "passkey") return;
      passkeyChallenge = { challenge, at: Date.now() };
    } catch {
      // Approve fetches one itself
    }
  }

  // True while the challenge for the "tap again" step is being fetched
  let fetching = false;

  // Set when a challenge had to be fetched on Approve, so the user taps again
  const [tapAgain, setTapAgain] = createSignal(false);

  createEffect(() => {
    setTapAgain(false);
    if (mode() === "passkey") prefetchPasskey();
  });

  /** Whether the typed code is a recovery code (the only kind if no app) */
  const recoveryMode = () => useRecovery() ?? !options()?.totp;

  /** Approve the request, with the entered code if needed */
  async function approve() {
    if (busy() || fetching) return;
    const value = code().trim().replace(/\s/g, "");
    if ((mode() === "password" || mode() === "code") && !value) return;

    setBusy(true);
    setError(undefined);
    try {
      let proof: QrApproveProof | undefined;
      if (mode() === "password") {
        proof = { password: code() };
      } else if (mode() === "code") {
        proof = recoveryMode()
          ? { recovery_code: value }
          : { totp_code: value };
      } else if (mode() === "passkey") {
        // the browser asks for the passkey; a dismissed prompt changes nothing
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
            challenge = await startWebAuthnMfa(client().api);
          } finally {
            fetching = false;
          }
          if (disposed) return;
          passkeyChallenge = { challenge, at: Date.now() };
          setTapAgain(true);
          return;
        }
        setTapAgain(false);
        passkeyChallenge = undefined;
        try {
          // no await before this call: the tap must reach the browser
          proof = await answerWithChallenge(stored.challenge);
        } catch (err) {
          // not spent by a dismissed prompt: keep the challenge
          if (isPromptCancelled(err)) passkeyChallenge = stored;
          throw err;
        }
        if (!proof) return;
      }
      await approveQrRequest(client().api, props.id, proof);
      // Refresh the session list in case settings are open
      client().sessions.fetch();
      answered = true;
      props.onClose();
    } catch (err) {
      if (isPromptCancelled(err)) return;
      // a failed attempt spent the challenge: get a new one
      if (mode() === "passkey") prefetchPasskey();
      if (err instanceof QrApiError && err.status === 404) {
        // Too many wrong answers, or the request expired: nothing left to try
        setLoadError(describe(err, true));
      } else {
        setError(describe(err, true));
      }
    } finally {
      // never keep a password or code around longer than needed
      setCode("");
      setBusy(false);
    }
  }

  /** Deny the request and close */
  async function deny() {
    if (busy()) return;
    setBusy(true);
    answered = true;
    try {
      await denyQrRequest(client().api, props.id);
    } catch {
      // nothing to undo: the request expires on its own
    }
    props.onClose();
  }

  /** Dismissed (Escape, backdrop, Close): free the other device if it waits */
  function dismiss() {
    if (busy()) return;
    if (shouldDenyOnClose(answered, !!loadError())) {
      answered = true;
      // fire and forget: the request expires on its own if this fails
      denyQrRequest(client().api, props.id).catch(() => {});
    }
    props.onClose();
  }

  return (
    <Dialog
      show={props.show}
      onClose={dismiss}
      title={<Trans>Log in a new device?</Trans>}
      icon={<Symbol>qr_code_scanner</Symbol>}
      actions={
        info() && !loadError()
          ? [
              {
                text: <Trans>Deny</Trans>,
                onClick: () => {
                  deny();
                  return false;
                },
                isDisabled: busy(),
              },
              {
                text: <Trans>Approve</Trans>,
                onClick: () => {
                  approve();
                  return false;
                },
                isDisabled:
                  busy() ||
                  ((mode() === "password" || mode() === "code") &&
                    code().trim() === ""),
              },
            ]
          : [{ text: <Trans>Close</Trans> }]
      }
      isDisabled={busy()}
    >
      <Switch>
        <Match when={loadError()}>
          <div role="alert">
            <Text>{loadError()}</Text>
          </div>
        </Match>
        <Match when={info()}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              approve();
            }}
          >
            <Column>
              <Facts>
                <dt>
                  <Trans>Device</Trans>
                </dt>
                <dd>{info()!.friendly_name || t`Unknown device`}</dd>
                <Show when={describeUserAgent(info()!.user_agent)}>
                  <dt>
                    <Trans>Browser</Trans>
                  </dt>
                  <dd>{describeUserAgent(info()!.user_agent)}</dd>
                </Show>
                <Show when={info()!.ip}>
                  <dt>
                    <Trans>Network address</Trans>
                  </dt>
                  <dd>{info()!.ip}</dd>
                </Show>
                <dt>
                  <Trans>Requested</Trans>
                </dt>
                <dd>
                  <Time value={info()!.created_at} format="relative" />
                </dd>
              </Facts>

              <Warning role="note">
                <Symbol>warning</Symbol>
                <Text>
                  <Trans>
                    Only approve this if you are looking at that device's screen
                    right now and it shows this QR code. Someone could send you
                    their QR code to take over your account.
                  </Trans>
                </Text>
              </Warning>

              <Show when={mode() === "password"}>
                <Text>
                  <Trans>
                    Enter your account password to approve this login.
                  </Trans>
                </Text>
                <TextField
                  label={t`Password`}
                  type="password"
                  value={code()}
                  onInput={(e) => setCode(e.currentTarget.value)}
                  autocomplete="current-password"
                  disabled={busy()}
                />
              </Show>
              <Show when={mode() === "code"}>
                <TextField
                  label={
                    recoveryMode() ? t`Recovery code` : t`Authenticator code`
                  }
                  value={code()}
                  onInput={(e) => setCode(e.currentTarget.value)}
                  inputmode={recoveryMode() ? "text" : "numeric"}
                  autocomplete="one-time-code"
                  disabled={busy()}
                />
                <Show when={options()?.totp && options()?.recovery}>
                  <Button
                    variant="text"
                    onPress={() => {
                      setUseRecovery(!recoveryMode());
                      setCode("");
                    }}
                  >
                    <Show
                      when={recoveryMode()}
                      fallback={<Trans>Use a recovery code instead</Trans>}
                    >
                      <Trans>Use the authenticator app instead</Trans>
                    </Show>
                  </Button>
                </Show>
              </Show>
              <Show when={mode() === "passkey"}>
                <Text>
                  <Trans>
                    Choose Approve, then confirm with your passkey when your
                    device asks.
                  </Trans>
                </Text>
                <Show when={tapAgain()}>
                  <div role="status">
                    <Text>
                      <Trans>
                        The passkey request is ready. Choose Approve once more.
                      </Trans>
                    </Text>
                  </div>
                </Show>
              </Show>
              {/* switch between the ways to prove it is you */}
              <Show when={mode() === "code" && passkeyPossible()}>
                <Button
                  variant="text"
                  onPress={() => {
                    setChosenMode("passkey");
                    setCode("");
                  }}
                >
                  <Trans>Use a passkey instead</Trans>
                </Button>
              </Show>
              <Show when={mode() === "passkey" && codePossible()}>
                <Button
                  variant="text"
                  onPress={() => {
                    setChosenMode("code");
                    setCode("");
                  }}
                >
                  <Trans>Use a code instead</Trans>
                </Button>
              </Show>

              <Show when={error()}>
                <div role="alert">
                  <Text class="label">
                    <span style={{ color: "var(--md-sys-color-error)" }}>
                      {error()}
                    </span>
                  </Text>
                </div>
              </Show>

              {/* lets Enter submit the form */}
              <button type="submit" hidden />
            </Column>
          </form>
        </Match>
        <Match when={true}>
          <CircularProgress />
        </Match>
      </Switch>
    </Dialog>
  );
}
