import { Match, Show, Switch, createMemo, createSignal } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import type { MFATicket } from "stoat.js";
import { css } from "styled-system/css";

import { useClient, useClientLifecycle } from "@revolt/client";
import {
  createMfaResource,
  createOwnProfileResource,
} from "@revolt/client/resources";
import { useModals } from "@revolt/modal";
import { CategoryButton, Column, Row, iconSize, useSnackbar } from "@revolt/ui";

import MdAlternateEmail from "@material-design-icons/svg/outlined/alternate_email.svg?component-solid";
import MdBlock from "@material-design-icons/svg/outlined/block.svg?component-solid";
import MdDelete from "@material-design-icons/svg/outlined/delete.svg?component-solid";
import MdLock from "@material-design-icons/svg/outlined/lock.svg?component-solid";
import MdMail from "@material-design-icons/svg/outlined/mail.svg?component-solid";
import MdPassword from "@material-design-icons/svg/outlined/password.svg?component-solid";
import MdVerifiedUser from "@material-design-icons/svg/outlined/verified_user.svg?component-solid";

import { useSettingsNavigation } from "../Settings";

import { Symbol } from "@revolt/ui/components/utils/Symbol";
import { UserSummary } from "./account/index";

/**
 * Account Page
 */
export function MyAccount() {
  const client = useClient();
  const profile = createOwnProfileResource();
  const { navigate } = useSettingsNavigation();

  return (
    <Column gap="lg">
      <UserSummary
        user={client().user!}
        bannerUrl={profile.data?.animatedBannerURL}
        bannerHue={profile.data?.bannerHue}
        onEdit={() => navigate("profile")}
        showBadges
      />
      <EditAccount />
      <MultiFactorAuth />
      <ManageAccount />
    </Column>
  );
}

/**
 * Edit account details
 */
function EditAccount() {
  const client = useClient();
  const { openModal } = useModals();
  const [email, setEmail] = createSignal("•••••••••••@•••••••••••");

  return (
    <CategoryButton.Group>
      <CategoryButton
        action="chevron"
        onClick={() =>
          openModal({
            type: "edit_username",
            client: client(),
          })
        }
        icon={<MdAlternateEmail {...iconSize(22)} />}
        description={client().user?.username}
      >
        <Trans>Username</Trans>
      </CategoryButton>
      <CategoryButton
        action="chevron"
        onClick={() =>
          openModal({
            type: "edit_email",
            client: client(),
          })
        }
        icon={<MdMail {...iconSize(22)} />}
        description={
          <Row>
            {email()}{" "}
            <Show when={email().startsWith("•")}>
              <a
                onClick={(event) => {
                  event.stopPropagation();
                  client().account.fetchEmail().then(setEmail);
                }}
              >
                <Trans>Reveal</Trans>
              </a>
            </Show>
          </Row>
        }
      >
        <Trans>Email</Trans>
      </CategoryButton>
      <CategoryButton
        action="chevron"
        onClick={() =>
          openModal({
            type: "edit_password",
            client: client(),
          })
        }
        icon={<MdPassword {...iconSize(22)} />}
        description={"•••••••••"}
      >
        <Trans>Password</Trans>
      </CategoryButton>
    </CategoryButton.Group>
  );
}

/**
 * Run an action that needs an MFA ticket.
 *
 * Handles a cancelled flow (no ticket) and failures, so callers never see an
 * unhandled rejection.
 * @param mfa MFA status resource
 * @returns Function taking the action to run with the ticket
 */
function createMfaAction(mfa: ReturnType<typeof createMfaResource>) {
  const { mfaFlow, showError } = useModals();

  /**
   * Like withTicket, but tells a cancelled flow apart from a failure
   * @param action Action to run with the ticket
   * @returns Done with the value, cancelled, or failed (error already shown)
   */
  async function withTicketResult<T>(
    action: (ticket: MFATicket) => Promise<T>,
  ): Promise<
    | { status: "done"; value: T }
    | { status: "cancelled" }
    | { status: "failed" }
  > {
    if (!mfa.data) return { status: "cancelled" };

    try {
      const ticket = await mfaFlow(mfa.data);
      if (!ticket) return { status: "cancelled" };

      return { status: "done", value: await action(ticket) };
    } catch (err) {
      showError(err);
      return { status: "failed" };
    }
  }

  /**
   * Ask for an MFA ticket and run the action with it
   * @param action Action to run with the ticket
   * @returns Result of the action, or undefined if cancelled or failed
   */
  async function withTicket<T>(
    action: (ticket: MFATicket) => Promise<T>,
  ): Promise<T | undefined> {
    const result = await withTicketResult(action);
    return result.status === "done" ? result.value : undefined;
  }

  return { withTicket, withTicketResult };
}

/**
 * Multi-factor authentication
 */
function MultiFactorAuth() {
  const client = useClient();
  const mfa = createMfaResource();
  const snackbar = useSnackbar();
  const { t } = useLingui();
  const { openModal, mfaEnableTOTP, showError, confirmRemoveAuthenticator } =
    useModals();
  const { withTicket, withTicketResult } = createMfaAction(mfa);

  /**
   * Show recovery codes
   */
  async function showRecoveryCodes() {
    const codes = await withTicket((ticket) => ticket.fetchRecoveryCodes());
    if (codes) openModal({ type: "mfa_recovery", mfa: mfa.data!, codes });
  }

  /**
   * Generate recovery codes
   */
  async function generateRecoveryCodes() {
    const codes = await withTicket((ticket) => ticket.generateRecoveryCodes());
    if (codes) openModal({ type: "mfa_recovery", mfa: mfa.data!, codes });
  }

  /**
   * Configure authenticator app
   */
  async function setupAuthenticatorApp() {
    const result = await withTicketResult((ticket) =>
      ticket.generateAuthenticatorSecret(),
    );
    if (result.status === "failed") return;
    if (result.status === "cancelled") {
      snackbar.show({ message: t`MFA setup canceled.` });
      return;
    }
    const secret = result.value;

    try {
      const enabled = await mfaEnableTOTP(
        secret,
        client().user!.username,
        (code) => mfa.data!.enableAuthenticator(code),
      );

      snackbar.show({
        message: enabled
          ? t`Authenticator app enabled.`
          : t`MFA setup canceled.`,
      });
    } catch (err) {
      if (err === "MFACancelled") {
        snackbar.show({ message: t`MFA setup canceled.` });
        return;
      }

      showError(err);
    }
  }

  /**
   * Disable authenticator app after confirmation
   */
  async function disableAuthenticatorApp() {
    if (!(await confirmRemoveAuthenticator())) return;

    const done = await withTicket(async (ticket) => {
      await ticket.disableAuthenticator();
      return true;
    });

    if (done) {
      snackbar.show({
        message: t`Authenticator removed. Two-factor authentication is off.`,
      });
    }
  }

  return (
    <CategoryButton.Group>
      <CategoryButton
        ignoreClick
        static
        icon={<MdVerifiedUser {...iconSize(22)} />}
        description={
          <Trans>
            Protects your account with a second step when you sign in or change
            sensitive settings.
          </Trans>
        }
        action={
          <TwoFactorStatus
            loading={mfa.isLoading}
            enabled={mfa.data?.authenticatorEnabled ?? false}
          />
        }
      >
        <Trans>Two-factor authentication</Trans>
      </CategoryButton>
      <CategoryButton.Collapse
        icon={<MdLock {...iconSize(22)} />}
        title={<Trans>Authenticator App</Trans>}
        description={<Trans>Configure one-time password authentication</Trans>}
      >
        <Switch
          fallback={
            <CategoryButton
              icon={<Symbol>mobile_lock_portrait</Symbol>}
              disabled={mfa.isLoading}
              onClick={setupAuthenticatorApp}
              description={<Trans>Setup one-time password authenticator</Trans>}
            >
              <Trans>Enable Authenticator</Trans>
            </CategoryButton>
          }
        >
          <Match when={!mfa.isLoading && mfa.data?.authenticatorEnabled}>
            <CategoryButton
              icon={<Symbol>remove_moderator</Symbol>}
              description={
                <Trans>Disable one-time password authenticator</Trans>
              }
              onClick={disableAuthenticatorApp}
            >
              <Trans>Remove Authenticator</Trans>
            </CategoryButton>
          </Match>
        </Switch>
      </CategoryButton.Collapse>
      <CategoryButton.Collapse
        icon={<Symbol>key</Symbol>}
        title={<Trans>Recovery Codes</Trans>}
        description={
          <Trans>
            Configure a way to get back into your account in case your 2FA is
            lost
          </Trans>
        }
      >
        <Switch
          fallback={
            <CategoryButton
              icon={<Symbol>key</Symbol>}
              disabled={mfa.isLoading}
              onClick={generateRecoveryCodes}
              description={<Trans>Setup recovery codes</Trans>}
            >
              <Trans>Generate Recovery Codes</Trans>
            </CategoryButton>
          }
        >
          <Match when={!mfa.isLoading && mfa.data?.recoveryEnabled}>
            <CategoryButton
              icon={<Symbol>visibility</Symbol>}
              description={<Trans>Get active recovery codes</Trans>}
              onClick={showRecoveryCodes}
            >
              <Trans>View Recovery Codes</Trans>
            </CategoryButton>
            <CategoryButton
              icon={<Symbol>lock_reset</Symbol>}
              description={<Trans>Get a new set of recovery codes</Trans>}
              onClick={generateRecoveryCodes}
            >
              <Trans>Reset Recovery Codes</Trans>
            </CategoryButton>
          </Match>
        </Switch>
      </CategoryButton.Collapse>
      {/* A future "Passkeys" row goes here, next to the other methods. */}
    </CategoryButton.Group>
  );
}

/**
 * Pill showing whether two-factor authentication is on or off.
 *
 * Uses an icon and text next to the colour, and a polite live region so screen
 * readers announce changes after enabling or removing the authenticator.
 */
function TwoFactorStatus(props: { loading: boolean; enabled: boolean }) {
  return (
    <Show
      when={!props.loading}
      fallback={
        <span class={css({ opacity: 0.7, flexShrink: 0 })}>
          <Trans>Checking…</Trans>
        </span>
      }
    >
      <span
        role="status"
        aria-live="polite"
        class={css({
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          flexShrink: 0,
          paddingBlock: "4px",
          paddingInline: "12px",
          borderRadius: "var(--borderRadius-full)",
          fontWeight: 500,
          background: props.enabled
            ? "var(--md-sys-color-primary-container)"
            : "var(--md-sys-color-surface-container-highest)",
          color: props.enabled
            ? "var(--md-sys-color-on-primary-container)"
            : "var(--md-sys-color-on-surface)",
        })}
      >
        {/* Symbol is aria-hidden, so only the On/Off text is announced */}
        <Symbol size={18} fill={props.enabled}>
          {props.enabled ? "check_circle" : "cancel"}
        </Symbol>
        {props.enabled ? <Trans>On</Trans> : <Trans>Off</Trans>}
      </span>
    </Show>
  );
}

/**
 * Manage account
 */
function ManageAccount() {
  const client = useClient();
  const mfa = createMfaResource();
  const { logout } = useClientLifecycle();
  const { withTicket } = createMfaAction(mfa);

  const stillOwnServers = createMemo(
    () =>
      client().servers.filter((server) => server.owner?.self || false).length >
      0,
  );

  /**
   * Disable account
   */
  function disableAccount() {
    withTicket(async (ticket) => {
      await ticket.disableAccount();
      logout();
    });
  }

  /**
   * Delete account
   */
  function deleteAccount() {
    withTicket(async (ticket) => {
      await ticket.deleteAccount();
      logout();
    });
  }

  return (
    <CategoryButton.Group>
      <CategoryButton
        action="chevron"
        disabled={mfa.isLoading}
        onClick={disableAccount}
        icon={<MdBlock {...iconSize(22)} fill="var(--md-sys-color-error)" />}
        description={
          <Trans>
            You won't be able to access your account unless you contact support
            - however, your data will not be deleted.
          </Trans>
        }
      >
        <Trans>Disable Account</Trans>
      </CategoryButton>
      <CategoryButton
        action={stillOwnServers() ? undefined : "chevron"}
        disabled={mfa.isLoading || stillOwnServers()}
        onClick={deleteAccount}
        icon={<MdDelete {...iconSize(22)} fill="var(--md-sys-color-error)" />}
        description={
          <Trans>
            Your account and all of your data (including your messages and
            friends list) will be queued for deletion. A confirmation email will
            be sent - you can cancel this within 7 days by contacting support.
          </Trans>
        }
      >
        <Switch fallback={<Trans>Delete Account</Trans>}>
          <Match when={stillOwnServers()}>
            <Trans>
              Cannot delete account until servers are deleted or transferred
            </Trans>
          </Match>
        </Switch>
      </CategoryButton>
    </CategoryButton.Group>
  );
}
