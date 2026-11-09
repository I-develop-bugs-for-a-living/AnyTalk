import {
  Match,
  Show,
  Switch,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { QRCodeSVG } from "solid-qr-code";

import { Trans } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useClientLifecycle } from "@revolt/client";
import { State } from "@revolt/client/Controller";
import {
  type QrAccount,
  type QrPollResult,
  QrApiError,
} from "@revolt/client/qrApi";
import { QR_LEVEL, encodeQrLogin } from "@revolt/client/qrLoginCode";
import { Navigate, useNavigate } from "@revolt/routing";
import { useState } from "@revolt/state";
import {
  Button,
  CircularProgress,
  Column,
  Row,
  Text,
  iconSize,
} from "@revolt/ui";

import MdArrowBack from "@material-design-icons/svg/filled/arrow_back.svg?component-solid";

import { FlowTitle } from "./Flow";

/** Time between checks on the request */
const POLL_INTERVAL = 2000;

/** Longest wait between checks when the server asks to slow down */
const MAX_BACKOFF = 30000;

/**
 * White tile behind the code so it scans in dark mode too
 */
const Tile = styled("div", {
  base: {
    alignSelf: "center",
    // quiet zone: a code needs a clear border of at least 4 modules
    padding: "28px",
    borderRadius: "var(--borderRadius-lg)",
    background: "white",
    width: "min(100%, 300px)",
    aspectRatio: "1 / 1",
    "& svg": {
      width: "100%",
      height: "100%",
      // hairline seams between neighbouring modules break scanning
      shapeRendering: "crispEdges",
    },
  },
});

type Approved = Extract<QrPollResult, { status: "approved" }>["session"];

/**
 * Flow for logging in by scanning a QR code with a device that is already
 * logged in
 */
export default function FlowQrLogin() {
  const state = useState();
  const { lifecycle, isLoggedIn, createQrLogin, pollQrLogin } =
    useClientLifecycle();
  const controller = useClientLifecycle();
  const navigate = useNavigate();

  const [id, setId] = createSignal<string>();
  const [status, setStatus] = createSignal<"pending" | "scanned" | "denied">(
    "pending",
  );
  const [failed, setFailed] = createSignal(false);
  const [revokeFailed, setRevokeFailed] = createSignal(false);
  const [approved, setApproved] = createSignal<{
    session: Approved;
    account?: QrAccount;
    failed?: boolean;
  }>();

  let secret = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;

  // Counts started codes, so an answer for an older code is dropped
  let generation = 0;

  // Approved session that the user has not confirmed yet. It must be revoked
  // if the user leaves instead of continuing.
  let unconfirmed: Approved | undefined;
  let proceeded = false;

  /** Ask for a fresh code and start checking on it */
  async function start() {
    clearTimeout(timer);
    const mine = ++generation;
    setStatus("pending");
    setFailed(false);
    setRevokeFailed(false);
    try {
      const request = await createQrLogin();
      if (!alive || mine !== generation) return;
      secret = request.secret;
      setId(request.id);
      schedule(request.id, POLL_INTERVAL);
    } catch (err) {
      if (!alive || mine !== generation) return;
      setFailed(true);
      // Try again later, more slowly when rate limited
      const limited = err instanceof QrApiError && err.status === 429;
      timer = setTimeout(start, limited ? 10000 : 5000);
    }
  }

  /**
   * Check again after a delay
   * @param current Request id the check belongs to
   * @param delay Milliseconds to wait
   */
  function schedule(current: string, delay: number) {
    timer = setTimeout(() => check(current, delay), delay);
  }

  /**
   * Check on the request once
   * @param current Request id
   * @param delay Delay that led to this check, for backing off
   */
  async function check(current: string, delay: number) {
    const mine = generation;
    try {
      const result = await pollQrLogin(current, secret);
      if (!alive || mine !== generation || current !== id()) return;

      switch (result.status) {
        case "approved":
          // Not logged in yet: first show whose account this is
          confirm(result.session);
          return;
        case "expired":
          // Silently replace the code
          start();
          return;
        case "denied":
          setStatus("denied");
          return;
        default:
          setStatus(result.status);
      }
      schedule(current, POLL_INTERVAL);
    } catch (err) {
      if (!alive || mine !== generation || current !== id()) return;
      // Never treat an error as a bad session; slow down and retry
      const limited = err instanceof QrApiError && err.status === 429;
      schedule(
        current,
        limited ? Math.min(delay * 2, MAX_BACKOFF) : POLL_INTERVAL * 2,
      );
    }
  }

  /**
   * Look up the account of the approved session so the user can check it
   * @param session Session from the server
   */
  async function confirm(session: Approved) {
    unconfirmed = session;
    setApproved({ session });
    try {
      const account = await controller.fetchQrAccount(session.token);
      if (alive && unconfirmed === session) setApproved({ session, account });
    } catch {
      if (alive && unconfirmed === session) {
        setApproved({ session, failed: true });
      }
    }
  }

  /** Log in with the approved session */
  function proceed() {
    const current = approved();
    if (!current || proceeded) return;
    proceeded = true;
    unconfirmed = undefined;
    controller.completeLogin(current.session);
  }

  /** Revoke the approved session and go back to a fresh code */
  async function cancel() {
    const current = unconfirmed;
    unconfirmed = undefined;
    setApproved(undefined);
    if (current && !(await controller.cancelQrSession(current))) {
      // Do not hide it: a session is left that the user should remove
      if (alive) setRevokeFailed(true);
      return;
    }
    if (alive) start();
  }

  /**
   * The page is closing: revoke with a request that outlives it. A page that
   * goes into the back/forward cache may come back, but it may also be evicted
   * without running any code, so the session is still revoked now and the
   * flow restarts on `pageshow`.
   * @param event Page transition event
   */
  function onPageHide(event: PageTransitionEvent) {
    if (unconfirmed && !proceeded) {
      controller.revokeQrSessionOnExit(unconfirmed);
      unconfirmed = undefined;
      if (event.persisted) setApproved(undefined);
    }
  }

  /**
   * The page came back from the back/forward cache: the code may be stale and
   * a session shown for confirmation was revoked, so start over
   * @param event Page transition event
   */
  function onPageShow(event: PageTransitionEvent) {
    if (event.persisted && !proceeded) start();
  }

  onMount(() => {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    start();
  });
  onCleanup(() => {
    alive = false;
    clearTimeout(timer);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    // left the screen without confirming
    if (unconfirmed && !proceeded) {
      controller.cancelQrSession(unconfirmed);
      unconfirmed = undefined;
    }
  });

  return (
    <Switch
      fallback={
        <>
          <FlowTitle subtitle={<Trans>Sign into AnyTalk</Trans>} emoji="wave">
            <Trans>Log in with QR code</Trans>
          </FlowTitle>

          <Column gap="lg">
            <Show
              when={id()}
              fallback={
                <Column align>
                  <CircularProgress />
                </Column>
              }
            >
              <Tile
                ref={(element: HTMLDivElement) =>
                  // without a viewBox the svg is cropped, not scaled, when the
                  // tile is narrower than 240px. The svg is added after the
                  // ref runs, so wait a tick.
                  queueMicrotask(() =>
                    element
                      .querySelector("svg")
                      ?.setAttribute("viewBox", "0 0 240 240"),
                  )
                }
              >
                <QRCodeSVG
                  value={encodeQrLogin(id()!, location.origin)}
                  level={QR_LEVEL}
                  backgroundColor="white"
                  foregroundColor="black"
                  height={240}
                  width={240}
                  backgroundAlpha={1}
                  foregroundAlpha={1}
                />
              </Tile>
            </Show>

            {/* announces changes of state to screen readers */}
            <div role="status" aria-live="polite">
              <Text>
                <Switch>
                  <Match when={revokeFailed()}>
                    <Trans>
                      The login was cancelled, but the new session could not be
                      removed. Remove it in Settings, then Sessions, on a device
                      where you are logged in.
                    </Trans>
                  </Match>
                  <Match when={failed()}>
                    <Trans>Could not reach the server. Trying again...</Trans>
                  </Match>
                  <Match when={status() === "scanned"}>
                    <Trans>Confirm on your other device.</Trans>
                  </Match>
                  <Match when={status() === "denied"}>
                    <Trans>The login was denied on the other device.</Trans>
                  </Match>
                  <Match when={true}>
                    <Trans>
                      Scan this with AnyTalk on a device where you're logged in.
                      Open Settings, then Sessions, then Link a device.
                    </Trans>
                  </Match>
                </Switch>
              </Text>
            </div>

            <Show when={status() === "denied" || revokeFailed()}>
              <Button onPress={start}>
                <Trans>Show a new code</Trans>
              </Button>
            </Show>

            <Row align justify>
              <Button variant="text" onPress={() => navigate("/login/auth")}>
                <MdArrowBack class="rtl-mirror" {...iconSize("1.2em")} />{" "}
                <Trans>Back</Trans>
              </Button>
            </Row>
          </Column>
        </>
      }
    >
      <Match when={isLoggedIn()}>
        <Navigate href={state.layout.popNextPath() ?? "/app"} />
      </Match>
      <Match when={lifecycle.state() === State.LoggingIn}>
        <CircularProgress />
      </Match>
      <Match when={approved()}>
        <FlowTitle>
          <Trans>Log in?</Trans>
        </FlowTitle>
        <Column gap="lg">
          <div role="status" aria-live="polite">
            <Text>
              <Switch>
                <Match when={approved()!.account}>
                  <Trans>
                    Log in as{" "}
                    <b>
                      {approved()!.account!.display_name ||
                        approved()!.account!.username}
                    </b>
                    ? If you don't recognise this account, cancel.
                  </Trans>
                </Match>
                <Match when={approved()!.failed}>
                  <Trans>
                    Could not check which account this is. Cancel and try again.
                  </Trans>
                </Match>
                <Match when={true}>
                  <Trans>Checking the account...</Trans>
                </Match>
              </Switch>
            </Text>
          </div>
          <Row align justify>
            <Button variant="text" onPress={cancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Button onPress={proceed} isDisabled={!approved()!.account}>
              <Trans>Continue</Trans>
            </Button>
          </Row>
        </Column>
      </Match>
    </Switch>
  );
}
