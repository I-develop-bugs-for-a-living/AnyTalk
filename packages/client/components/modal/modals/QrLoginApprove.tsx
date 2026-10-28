import {
  Match,
  Show,
  Switch,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import {
  type QrInfo,
  QrApiError,
  approveMethod,
  approveQrRequest,
  denyQrRequest,
  describeUserAgent,
  getQrInfo,
} from "@revolt/client/qrApi";
import {
  Button,
  CircularProgress,
  Column,
  Dialog,
  DialogProps,
  Text,
  TextField,
  Time,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

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
  const [useRecovery, setUseRecovery] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  /**
   * Readable text for a failed request
   * @param err Error thrown by the request
   * @param approving Whether the code input was part of the request
   */
  function describe(err: unknown, approving: boolean): string {
    const status = err instanceof QrApiError ? err.status : 0;
    if (
      status === 400 &&
      err instanceof QrApiError &&
      err.type === "InvalidOperation"
    ) {
      return t`This request cannot be approved right now. Ask the other device to show a new QR code.`;
    }
    if (status === 404) {
      return t`This login request has expired or was already answered. Ask the other device to show a new QR code.`;
    }
    if (status === 401 && approving) {
      return method() === "password"
        ? t`That password is not correct. Check it and try again.`
        : t`That code is not correct. Check it and try again.`;
    }
    if (status === 403) {
      return t`Too many wrong codes. Wait a while before trying again.`;
    }
    if (status === 400) {
      return t`This request cannot be approved right now. Ask the other device to show a new QR code.`;
    }
    if (status === 429) {
      return t`Too many attempts. Wait a moment and try again.`;
    }
    return t`Something went wrong. Check your connection and try again.`;
  }

  onCleanup(() => setCode(""));

  onMount(async () => {
    try {
      setInfo(await getQrInfo(client().api, props.id));
    } catch (err) {
      setLoadError(describe(err, false));
    }
  });

  /** Proof the approval needs, if any */
  const method = () => {
    const current = info();
    return current ? approveMethod(current) : undefined;
  };

  /** Approve the request, with the entered code if needed */
  async function approve() {
    if (busy()) return;
    const value = code().trim().replace(/\s/g, "");
    if (method() && !value) return;

    setBusy(true);
    setError(undefined);
    try {
      await approveQrRequest(
        client().api,
        props.id,
        method() === "password"
          ? { password: code() }
          : method()
            ? useRecovery()
              ? { recovery_code: value }
              : { totp_code: value }
            : undefined,
      );
      // Refresh the session list in case settings are open
      client().sessions.fetch();
      props.onClose();
    } catch (err) {
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
    try {
      await denyQrRequest(client().api, props.id);
    } catch {
      // nothing to undo: the request expires on its own
    }
    props.onClose();
  }

  return (
    <Dialog
      show={props.show}
      onClose={() => (busy() ? undefined : props.onClose())}
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
                  busy() || (method() !== undefined && code().trim() === ""),
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

              <Show when={method() === "password"}>
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
              <Show when={method() === "totp_or_recovery"}>
                <TextField
                  label={
                    useRecovery() ? t`Recovery code` : t`Authenticator code`
                  }
                  value={code()}
                  onInput={(e) => setCode(e.currentTarget.value)}
                  inputmode={useRecovery() ? "text" : "numeric"}
                  autocomplete="one-time-code"
                  disabled={busy()}
                />
                <Button
                  variant="text"
                  onPress={() => {
                    setUseRecovery(!useRecovery());
                    setCode("");
                  }}
                >
                  <Show
                    when={useRecovery()}
                    fallback={<Trans>Use a recovery code instead</Trans>}
                  >
                    <Trans>Use the authenticator app instead</Trans>
                  </Show>
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
