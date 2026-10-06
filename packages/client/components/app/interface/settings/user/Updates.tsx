import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  createSignal,
  onMount,
} from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { css } from "styled-system/css";

import { CONFIGURATION } from "@revolt/common";
import { Markdown } from "@revolt/markdown";
import {
  Button,
  CategoryButton,
  Checkbox,
  CircularProgress,
  Column,
  Row,
  Text,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  type GithubRelease,
  isNewerVersion,
  releaseNotesFor,
  releaseVersion,
} from "./desktopRelease";
import { updaterState, watchUpdater } from "./updaterState";

/**
 * Load the desktop releases, patch notes included
 * @throws When GitHub can't be reached or refuses the request (e.g. rate limit)
 */
async function fetchReleases(): Promise<GithubRelease[]> {
  const response = await fetch(
    `https://api.github.com/repos/${CONFIGURATION.DESKTOP_RELEASES_REPO}/releases?per_page=50`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return (await response.json()) as GithubRelease[];
}

/** Progress bar, native element so screen readers announce the value */
const progressClass = css({
  width: "100%",
  height: "8px",
  accentColor: "var(--md-sys-color-primary)",
});

/** One release in the patch notes */
const releaseClass = css({
  padding: "16px",
  borderRadius: "var(--borderRadius-lg)",
  background: "var(--md-sys-color-surface-container)",
  color: "var(--md-sys-color-on-surface)",
  overflowWrap: "anywhere",
});

/** Link to a release page, styled as a tonal button */
const linkButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "40px",
  paddingInline: "24px",
  borderRadius: "var(--borderRadius-full)",
  background: "var(--md-sys-color-secondary-container)",
  color: "var(--md-sys-color-on-secondary-container)",
  textDecoration: "none",
  textAlign: "center",
  "&:focus-visible": {
    outline: "2px solid var(--md-sys-color-primary)",
    outlineOffset: "2px",
  },
});

/**
 * Updates page of the desktop app: status, update settings and patch notes
 */
export default function Updates() {
  const { t, i18n } = useLingui();

  /** Installed version, empty when the shell doesn't tell */
  const installed = () => window.native?.versions?.desktop?.() ?? "";

  /** Settings copy, only the update toggle is used here */
  const [config, setConfig] = createSignal(window.desktopConfig?.get());
  const autoUpdate = () => config()?.autoUpdate !== false;

  /** Problem talking to the updater, shown under the status */
  const [actionError, setActionError] = createSignal<string>();

  onMount(watchUpdater);

  // fetched once per page open, no polling
  const [releases] = createResource(() => fetchReleases().catch(() => null));
  const notes = () => releaseNotesFor(releases() ?? [], installed());

  /** The updater of this desktop app, when it can update itself */
  const canSelfUpdate = () =>
    !!window.desktopUpdater && updaterState()?.status !== "unsupported";

  /** Newest release when it is newer than the installed version (no-updater fallback) */
  const newerRelease = () => {
    const newest = notes()[0];
    return newest && isNewerVersion(releaseVersion(newest), installed())
      ? newest
      : undefined;
  };

  /**
   * Run an updater action and show a message when it fails
   * @param action What to call on the updater
   */
  async function run(action: () => Promise<void> | void) {
    try {
      setActionError();
      await action();
    } catch (err) {
      console.error("[updater] action failed", err);
      setActionError(t`Could not reach the updater. Try again.`);
    }
  }

  /** Save the automatic update setting */
  async function toggleAutoUpdate() {
    try {
      setConfig(await window.desktopConfig.set({ autoUpdate: !autoUpdate() }));
      setActionError();
    } catch (err) {
      console.error("[desktop] could not save settings", err);
      setActionError(t`Could not save this setting.`);
    }
  }

  /**
   * Format a release date for the current language
   * @param value ISO date
   */
  function formatDate(value?: string | null) {
    const date = value ? new Date(value) : undefined;
    if (!date || isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(i18n().locale, { dateStyle: "long" }).format(
      date,
    );
  }

  return (
    <Column gap="lg">
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>system_update</Symbol>}
          description={<Trans>Installed version</Trans>}
        >
          <Trans>AnyTalk Desktop {installed()}</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Column>
        {/* polite live region, so screen readers hear status changes */}
        <div role="status" aria-live="polite">
          <Show
            when={canSelfUpdate()}
            fallback={
              <Show
                when={newerRelease()}
                fallback={
                  <Show when={releases()?.length}>
                    <Text class="body">
                      <Trans>AnyTalk is up to date.</Trans>
                    </Text>
                  </Show>
                }
              >
                {(release) => (
                  <Text class="body">
                    <Trans>Update available: {releaseVersion(release())}</Trans>
                  </Text>
                )}
              </Show>
            }
          >
            <Switch
              fallback={
                <Text class="body">
                  <Trans>
                    Check for updates to see if there is a new version.
                  </Trans>
                </Text>
              }
            >
              <Match when={updaterState()?.status === "checking"}>
                <Text class="body">
                  <Trans>Checking for updates…</Trans>
                </Text>
              </Match>
              <Match when={updaterState()?.status === "up-to-date"}>
                <Text class="body">
                  <Trans>AnyTalk is up to date.</Trans>
                </Text>
              </Match>
              <Match when={updaterState()?.status === "available"}>
                <Text class="body">
                  <Trans>Update available: {updaterState()?.version}</Trans>
                </Text>
              </Match>
              <Match when={updaterState()?.status === "downloading"}>
                <Text class="body">
                  <Trans>
                    Downloading {Math.round(updaterState()?.percent ?? 0)}%
                  </Trans>
                </Text>
              </Match>
              <Match when={updaterState()?.status === "downloaded"}>
                <Text class="body">
                  <Trans>Ready to install: {updaterState()?.version}</Trans>
                </Text>
              </Match>
              <Match when={updaterState()?.status === "error"}>
                <Text class="body">
                  <Trans>Update failed</Trans>
                </Text>
                <Show when={updaterState()?.error}>
                  <div>
                    <Text class="label">{updaterState()?.error}</Text>
                  </div>
                </Show>
              </Match>
            </Switch>
          </Show>
        </div>

        <Show
          when={canSelfUpdate() && updaterState()?.status === "downloading"}
        >
          <progress
            class={progressClass}
            max={100}
            value={Math.round(updaterState()?.percent ?? 0)}
            aria-label={t`Update download progress`}
          />
        </Show>

        <Show when={actionError()}>
          <div role="alert">
            <Text class="label">{actionError()}</Text>
          </div>
        </Show>

        <Show
          when={canSelfUpdate()}
          fallback={
            <Show when={newerRelease()}>
              {(release) => (
                <a
                  class={linkButtonClass}
                  href={release().html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Text class="label">
                    <Trans>Open release page</Trans>
                  </Text>
                </a>
              )}
            </Show>
          }
        >
          <Row>
            <Show
              when={
                updaterState()?.status === "available" ||
                (updaterState()?.status === "error" && updaterState()?.version)
              }
            >
              <Button
                onPress={() => run(() => window.desktopUpdater?.download())}
              >
                <Show
                  when={updaterState()?.status === "error"}
                  fallback={<Trans>Download</Trans>}
                >
                  <Trans>Download again</Trans>
                </Show>
              </Button>
            </Show>
            <Show when={updaterState()?.status === "downloaded"}>
              <Button
                onPress={() => run(() => window.desktopUpdater?.install())}
              >
                <Trans>Restart to install</Trans>
              </Button>
            </Show>
            <Button
              variant="tonal"
              isDisabled={
                updaterState()?.status === "checking" ||
                updaterState()?.status === "downloading"
              }
              onPress={() => run(() => window.desktopUpdater?.check())}
            >
              <Show
                when={updaterState()?.status === "error"}
                fallback={<Trans>Check for updates</Trans>}
              >
                <Trans>Try again</Trans>
              </Show>
            </Button>
          </Row>
        </Show>
      </Column>

      {/* the toggle needs the updater, so older desktop versions don't show it */}
      <Show when={canSelfUpdate() && window.desktopConfig}>
        <CategoryButton.Group>
          <CategoryButton
            action={<Checkbox checked={autoUpdate()} />}
            onClick={toggleAutoUpdate}
            icon={<Symbol>autorenew</Symbol>}
            description={
              <Trans>
                Updates download in the background and install when you restart
                AnyTalk. Turn off to decide yourself when to update.
              </Trans>
            }
          >
            <Trans>Install updates automatically</Trans>
          </CategoryButton>
        </CategoryButton.Group>
      </Show>

      <Column>
        <Text class="title">
          <Trans>What's new</Trans>
        </Text>
        <Show when={!releases.loading} fallback={<CircularProgress />}>
          <Show
            when={releases() !== null}
            fallback={
              <div role="alert">
                <Text class="label">
                  <Trans>Could not load the patch notes right now.</Trans>
                </Text>
              </div>
            }
          >
            <Show
              when={notes().length}
              fallback={
                <Text class="body">
                  <Trans>No patch notes for this version.</Trans>
                </Text>
              }
            >
              <For each={notes()}>
                {(release) => (
                  <article class={releaseClass}>
                    <Text class="title">
                      <Trans>Version {releaseVersion(release)}</Trans>
                    </Text>
                    <Show when={formatDate(release.published_at)}>
                      <div>
                        <Text class="label">
                          {formatDate(release.published_at)}
                        </Text>
                      </div>
                    </Show>
                    <Markdown content={release.body ?? ""} />
                  </article>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </Column>
    </Column>
  );
}
