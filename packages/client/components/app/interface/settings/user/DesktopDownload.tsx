import { For, Match, Show, Switch, createResource } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { css } from "styled-system/css";

import { CONFIGURATION } from "@revolt/common";
import { Button, CircularProgress, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  type DesktopDownload as Download,
  type GithubRelease,
  detectPlatform,
  formatSize,
  pickDesktopRelease,
  pickPrimaryDownload,
  releaseDownloads,
  releaseVersion,
} from "./desktopRelease";

/** Where the releases of the configured repository are listed */
const releasesPage = () =>
  `https://github.com/${CONFIGURATION.DESKTOP_RELEASES_REPO}/releases`;

/**
 * Load the newest desktop release, undefined when there is none yet
 * @throws When GitHub can't be reached or refuses the request (e.g. rate limit)
 */
async function fetchRelease(): Promise<GithubRelease | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/${CONFIGURATION.DESKTOP_RELEASES_REPO}/releases?per_page=50`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return pickDesktopRelease((await response.json()) as GithubRelease[]);
}

/** Link to the releases page, styled as text */
const linkClass = css({
  color: "var(--md-sys-color-primary)",
  textDecoration: "underline",
});

/** Text for screen readers only */
const hiddenClass = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
});

/** Download link styled as a filled button */
const primaryClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  minHeight: "48px",
  paddingInline: "24px",
  borderRadius: "var(--borderRadius-full)",
  background: "var(--md-sys-color-primary)",
  color: "var(--md-sys-color-on-primary)",
  textDecoration: "none",
  textAlign: "center",
  transition: "var(--transitions-fast)",
  "&:hover": { filter: "brightness(1.08)" },
  "&:focus-visible": {
    outline: "2px solid var(--md-sys-color-primary)",
    outlineOffset: "2px",
  },
});

/** Row in the list of other downloads */
const rowClass = css({
  display: "flex",
  alignItems: "center",
  gap: "16px",
  minHeight: "56px",
  paddingBlock: "8px",
  paddingInline: "16px",
  borderRadius: "var(--borderRadius-md)",
  background: "var(--md-sys-color-surface-container)",
  color: "var(--md-sys-color-on-surface)",
  textDecoration: "none",
  transition: "var(--transitions-fast)",
  "&:hover": { background: "var(--md-sys-color-surface-container-high)" },
  "&:focus-visible": {
    outline: "2px solid var(--md-sys-color-primary)",
    outlineOffset: "2px",
  },
});

/** Centered, quiet block for loading, empty and error states */
const centeredClass = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "8px",
  paddingBlock: "32px",
  paddingInline: "16px",
  textAlign: "center",
  color: "var(--md-sys-color-on-surface-variant)",
});

/**
 * Download page for the desktop app, shown in the web version only.
 * The release list is fetched when the page opens.
 */
export default function DesktopDownload() {
  const { t } = useLingui();
  const [release, { refetch }] = createResource(fetchRelease);

  const platform = detectPlatform({
    userAgent: navigator.userAgent,
    // not in all browsers or in TypeScript's DOM types yet
    uaDataPlatform: (
      navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData?.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });

  /**
   * Friendly name of an installer
   * @param download Installer to name
   */
  function label(download: Download) {
    switch (download.format) {
      case "exe":
        return t`Windows installer`;
      case "appimage":
        return t`Linux AppImage`;
      case "deb":
        return t`Linux .deb (Debian/Ubuntu)`;
      case "rpm":
        return t`Linux .rpm (Fedora)`;
      case "pacman":
        return t`Linux pacman (Arch)`;
    }
  }

  /**
   * Short format name for the main button
   * @param download Installer to name
   */
  function buttonLabel(download: Download) {
    return download.format === "exe"
      ? t`Download for Windows (.exe)`
      : t`Download for Linux (AppImage)`;
  }

  /**
   * Architecture shown next to a Linux download
   * @param download Installer to describe
   */
  function arch(download: Download) {
    return download.os === "linux" && download.arch !== "unknown"
      ? download.arch
      : "";
  }

  return (
    <Column gap="lg">
      <Column gap="sm">
        <Symbol size={48}>desktop_windows</Symbol>
        <Text class="headline" size="small">
          <Trans>Get AnyTalk for your desktop</Trans>
        </Text>
        <Text class="body">
          <Trans>
            Use hotkeys that work even while AnyTalk isn't focused, and keep
            AnyTalk running in the system tray.
          </Trans>
        </Text>
      </Column>

      <Switch>
        <Match when={release.loading}>
          <div class={centeredClass} role="status" aria-live="polite">
            <CircularProgress />
            <Text class="body">
              <Trans>Looking for the latest version...</Trans>
            </Text>
          </div>
        </Match>

        <Match when={release.error}>
          <div class={centeredClass} role="alert">
            <Symbol size={48}>cloud_off</Symbol>
            <Text class="title">
              <Trans>Couldn't load downloads</Trans>
            </Text>
            <Text class="body">
              <Trans>
                GitHub didn't answer, or too many requests were made. Try again
                later, or get the app from the{" "}
                <a
                  class={linkClass}
                  href={releasesPage()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  releases page
                </a>
                .
              </Trans>
            </Text>
            <Button onPress={() => refetch()}>
              <Trans>Try again</Trans>
            </Button>
          </div>
        </Match>

        <Match when={!release()}>
          <div class={centeredClass}>
            <Symbol size={48}>download</Symbol>
            <Text class="title">
              <Trans>No desktop app available yet</Trans>
            </Text>
            <Text class="body">
              <Trans>
                The first version hasn't been published. Check back soon.
              </Trans>
            </Text>
          </div>
        </Match>

        <Match when={release()}>
          {(current) => {
            const downloads = () => releaseDownloads(current());
            const primary = () => pickPrimaryDownload(downloads(), platform);
            const version = () => releaseVersion(current());
            const others = () => downloads().filter((d) => d !== primary());

            return (
              <>
                <Column gap="sm">
                  <Show
                    when={primary()}
                    fallback={
                      <Text class="body">
                        <Trans>
                          The desktop app is available for Windows and Linux.
                        </Trans>
                      </Text>
                    }
                  >
                    {(download) => (
                      <a
                        class={primaryClass}
                        href={download().url}
                        download={download().name}
                      >
                        <Symbol size={20}>download</Symbol>
                        <Text class="label" size="large">
                          {buttonLabel(download())}
                        </Text>
                      </a>
                    )}
                  </Show>
                  <Text class="label">
                    <span
                      class={css({
                        display: "inline-flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        columnGap: "16px",
                      })}
                    >
                      <span>
                        <Trans>Version {version()}</Trans>
                      </span>
                      <a
                        class={linkClass}
                        href={current().html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Trans>Release notes</Trans>
                        <Symbol size={16}>open_in_new</Symbol>
                        <span class={hiddenClass}>
                          <Trans>(opens in a new tab)</Trans>
                        </span>
                      </a>
                    </span>
                  </Text>
                </Column>

                <Show when={others().length}>
                  <Column gap="sm">
                    <Text class="title" size="small">
                      <Trans>Other downloads</Trans>
                    </Text>
                    <ul
                      class={css({
                        listStyle: "none",
                        margin: 0,
                        padding: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      })}
                    >
                      <For each={others()}>
                        {(download) => (
                          <li>
                            <a
                              class={rowClass}
                              href={download.url}
                              download={download.name}
                            >
                              <Symbol size={24}>download</Symbol>
                              <span class={css({ flex: 1, minWidth: 0 })}>
                                <Text class="label" size="large">
                                  {label(download)}
                                  {arch(download) ? ` (${arch(download)})` : ""}
                                </Text>
                              </span>
                              <Text class="label">
                                {formatSize(download.size)}
                              </Text>
                            </a>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Column>
                </Show>
              </>
            );
          }}
        </Match>
      </Switch>
    </Column>
  );
}
