import { Show } from "solid-js";

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/solid/macro";
import { Server } from "stoat.js";
import { css } from "styled-system/css";

import { useClient, useClientLifecycle } from "@revolt/client";
import { SOURCE_CODE_URL, UPSTREAM_URL } from "@revolt/common/lib/branding";
import { hardReload } from "@revolt/common/lib/hardReload";
import { useInstance } from "@revolt/instance";
import { useUser } from "@revolt/markdown/users";
import { useModals } from "@revolt/modal";
import { ColouredText, Column, Text, iconSize } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import MdAccountCircle from "@material-design-icons/svg/outlined/account_circle.svg?component-solid";
import MdLanguage from "@material-design-icons/svg/outlined/language.svg?component-solid";
import MdLogout from "@material-design-icons/svg/outlined/logout.svg?component-solid";
import MdMemory from "@material-design-icons/svg/outlined/memory.svg?component-solid";
import MdMic from "@material-design-icons/svg/outlined/mic.svg?component-solid";
import MdNotifications from "@material-design-icons/svg/outlined/notifications.svg?component-solid";
import MdPalette from "@material-design-icons/svg/outlined/palette.svg?component-solid";
import MdScience from "@material-design-icons/svg/outlined/science.svg?component-solid";
import MdSmartToy from "@material-design-icons/svg/outlined/smart_toy.svg?component-solid";
import MdVerifiedUser from "@material-design-icons/svg/outlined/verified_user.svg?component-solid";

import pageTexts from "virtual:settings-search";

import pkg from "../../../../../../package.json";

import { SettingsConfiguration, SettingsList } from ".";
import { AccountCard, BackCard } from "./user/_AccountCard";
import { MyAccount } from "./user/Account";
import AdvancedSettings from "./user/Advanced";
import { AppearanceMenu } from "./user/appearance";
import { MyBots, ViewBot } from "./user/bots";
import DesktopDownload from "./user/DesktopDownload";
import { CompareRecaps } from "./user/developer/CompareRecaps";
import {
  DeveloperSettings,
  StreamStatsSettings,
  VoiceStatsSettings,
} from "./user/developer/Developer";
import { Feedback } from "./user/Feedback";
import { HotkeysSettings } from "./user/Hotkeys";
import { LanguageSettings } from "./user/Language";
import Native from "./user/Native";
import Notifications from "./user/notifications/Notifications";
import { EditProfile } from "./user/profile";
import { Sessions } from "./user/Sessions";
import { VoiceSettings } from "./user/voice/VoiceSettings";

const Config: SettingsConfiguration<{ server: Server }> = {
  /**
   * Page titles
   * @param key
   */
  title(ctx, key) {
    if (key === "developer/voice") return i18n._(msg`Voice Call Stats`);
    if (key === "developer/streams") return i18n._(msg`Stream Stats`);
    if (key === "developer/compare") return i18n._(msg`Compare Recaps`);

    if (key.startsWith("bots/")) {
      const user = useUser(key.substring(5));
      return user()!.username;
    }

    return ctx.entries
      .flatMap((category) => category.entries)
      .find((entry) => entry.id === key)?.title as string;
  },

  /**
   * Render the current client settings page
   */
  // we take care of the reactivity ourselves
  /* eslint-disable solid/reactivity */
  /* eslint-disable solid/components-return-once */
  render(props) {
    const id = props.page();
    const client = useClient();

    if (id?.startsWith("bots/")) {
      const bot = client().bots.get(id.substring("bots/".length))!;
      return <ViewBot bot={bot!} />;
    }

    switch (id) {
      case "account":
        return <MyAccount />;
      case "appearance":
        return <AppearanceMenu />;
      case "advanced":
        return <AdvancedSettings />;
      case "developer":
        return <DeveloperSettings />;
      case "developer/voice":
        return <VoiceStatsSettings />;
      case "developer/streams":
        return <StreamStatsSettings />;
      case "developer/compare":
        return <CompareRecaps />;
      case "profile":
        return <EditProfile />;
      case "sessions":
        return <Sessions />;
      case "bots":
        return <MyBots />;
      case "language":
        return <LanguageSettings />;
      case "feedback":
        return <Feedback />;
      case "native":
        return <Native />;
      case "desktop-download":
        return <DesktopDownload />;
      case "voice":
        return <VoiceSettings />;
      case "keybinds":
        return <HotkeysSettings />;
      case "notifications":
        return <Notifications isDesktop={!!window.native} />;
      default:
        return null;
    }
  },
  /* eslint-enable solid/reactivity */
  /* eslint-enable solid/components-return-once */

  /**
   * Generate list of categories / entries for client settings
   * @returns List
   */
  list(_, onClose) {
    const { pop } = useModals();
    const { logout } = useClientLifecycle();
    const { limits, config } = useInstance();
    const { t } = useLingui();

    return withPageTexts({
      context: null!,
      prepend: (
        <Column gap="s">
          <BackCard onClose={onClose} />
          <AccountCard />
          <div />
        </Column>
      ),
      append: (
        <Column gap="none">
          <Text class="label">
            <span class={css({ userSelect: "none", fontWeight: "bold" })}>
              <Trans>Version:</Trans>
            </span>{" "}
            <span class={css({ userSelect: "all" })}>{pkg.version}</span>
          </Text>
          <Text class="label">
            <span
              class={css({
                opacity: "0.5",
                "& a": {
                  color: "inherit",
                  textDecoration: "none",
                  "&:hover": { textDecoration: "underline" },
                },
              })}
            >
              <Trans>
                Built on{" "}
                <a
                  href={UPSTREAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Stoat
                </a>
              </Trans>
            </span>
          </Text>
          <Show when={window.native}>
            <Text class="label">
              AnyTalk for Desktop {window.native.versions.desktop()}
            </Text>
            <Text class="label">
              <span
                class={css({
                  fontSize: "0.8em",
                  lineHeight: "0.8em",
                  opacity: "0.5",
                })}
              >
                {window.native.versions.electron()},{" "}
                {window.native.versions.node()},{" "}
                {window.native.versions.chrome()}
              </span>
            </Text>
          </Show>
          <Show when={config.features.legal_links}>
            {(links) => (
              <Text class="label">
                <span
                  class={css({
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5em",
                    opacity: "0.5",
                    "& a": {
                      color: "inherit",
                      textDecoration: "none",
                      "&:hover": { textDecoration: "underline" },
                    },
                  })}
                >
                  <Show when={links().terms_of_service}>
                    <a
                      href={links().terms_of_service}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Trans>Terms</Trans>
                    </a>
                  </Show>
                  <Show when={links().privacy_policy}>
                    <a
                      href={links().privacy_policy}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Trans>Privacy</Trans>
                    </a>
                  </Show>
                  <Show when={links().guidelines}>
                    <a
                      href={links().guidelines}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Trans>Guidelines</Trans>
                    </a>
                  </Show>
                </span>
              </Text>
            )}
          </Show>
        </Column>
      ),
      entries: [
        {
          title: <Trans>User Settings</Trans>,
          entries: [
            {
              id: "account",
              icon: <MdAccountCircle {...iconSize(20)} />,
              title: <Trans>My Account</Trans>,
              // the account card opens it, only search lists it
              hidden: true,
            },
            {
              id: "profile",
              icon: <MdAccountCircle {...iconSize(20)} />,
              title: <Trans>Profile</Trans>,
            },
            {
              id: "sessions",
              icon: <MdVerifiedUser {...iconSize(20)} />,
              title: <Trans>Sessions</Trans>,
            },
          ],
        },
        {
          title: "AnyTalk",
          entries: [
            {
              id: "bots",
              icon: <MdSmartToy {...iconSize(20)} />,
              title: <Trans>My Bots</Trans>,
            },
          ],
        },
        {
          title: <Trans>Client Settings</Trans>,
          entries: [
            // {
            //   id: "audio",
            //   icon: <MdSpeaker {...iconSize(20)} />,
            //   title: t("app.settings.pages.audio.title"),
            //   hidden:
            //     !getController("state").experiments.isEnabled("voice_chat"),
            // },
            {
              id: "voice",
              icon: <MdMic {...iconSize(20)} />,
              title: limits().video ? (
                <Trans>Voice & Video</Trans>
              ) : (
                <Trans>Voice</Trans>
              ),
              // words for it that aren't on the page
              keywords: [
                t`Microphone`,
                t`Speaker`,
                t`Camera`,
                t`Noise suppression`,
              ],
            },
            {
              id: "appearance",
              icon: <MdPalette {...iconSize(20)} />,
              title: <Trans>Appearance</Trans>,
            },
            // {
            //   id: "accessibility",
            //   icon: <MdAccessibility {...iconSize(20)} />,
            //   title: t("app.settings.pages.accessibility.title"),
            // },
            // {
            //   id: "plugins",
            //   icon: <MdExtension {...iconSize(20)} />,
            //   title: t("app.settings.pages.plugins.title"),
            //   hidden: !getController("state").experiments.isEnabled("plugins"),
            // },
            {
              id: "notifications",
              icon: <MdNotifications {...iconSize(20)} />,
              title: <Trans>Notifications</Trans>,
            },
            {
              id: "keybinds",
              icon: <Symbol size={20}>keyboard</Symbol>,
              title: <Trans>Hotkeys</Trans>,
            },
            {
              id: "language",
              icon: <MdLanguage {...iconSize(20)} />,
              title: <Trans>Language</Trans>,
            },
            // {
            //   id: "sync",
            //   icon: <MdSync {...iconSize(20)} />,
            //   title: t("app.settings.pages.sync.title"),
            // },
            {
              id: "native",
              hidden: !window.native,
              icon: <Symbol size={20}>desktop_windows</Symbol>,
              title: <Trans>Desktop</Trans>,
            },
            {
              // web version only: the desktop app has its own "native" page
              id: "desktop-download",
              hidden: !!window.native,
              icon: <Symbol size={20}>download</Symbol>,
              title: <Trans>Desktop app</Trans>,
            },
            // {
            //   id: "experiments",
            //   icon: <MdScience {...iconSize(20)} />,
            //   title: <Trans>Experiments</Trans>,
            // },
          ],
        },
        {
          entries: [
            {
              href: SOURCE_CODE_URL,
              icon: <MdMemory {...iconSize(20)} />,
              title: <Trans>Source Code</Trans>,
            },
            {
              id: "advanced",
              icon: <MdScience {...iconSize(20)} />,
              title: <Trans>Advanced</Trans>,
            },
            {
              id: "developer",
              icon: <Symbol size={20}>code</Symbol>,
              title: <Trans>Developer</Trans>,
            },
            {
              id: "reload",
              icon: <Symbol size={20}>refresh</Symbol>,
              title: <Trans>Reload and clear cache</Trans>,
              onClick() {
                if (
                  confirm(
                    t`Reload AnyTalk with fresh files from the server? This is the same as Ctrl+F5 and fixes most display problems after an update. You stay logged in and keep your settings.`,
                  )
                ) {
                  hardReload().then((reloading) => {
                    if (!reloading)
                      alert(
                        t`You're offline. Connect to the internet first, otherwise AnyTalk couldn't load again.`,
                      );
                  });
                }
              },
            },
            {
              id: "logout",
              icon: (
                <MdLogout
                  class="rtl-mirror"
                  {...iconSize(20)}
                  fill="var(--md-sys-color-error)"
                />
              ),
              title: (
                <ColouredText colour="var(--md-sys-color-error)">
                  <Trans>Log Out</Trans>
                </ColouredText>
              ),
              onClick() {
                pop();
                logout();
              },
            },
          ],
        },
      ],
    });
  },
};

/**
 * Let searching the settings find a page by the texts on it, translated
 * @param list Settings list
 * @returns List with each page's texts added to its keywords
 */
function withPageTexts<T>(list: SettingsList<T>): SettingsList<T> {
  for (const category of list.entries)
    for (const entry of category.entries) {
      const texts = entry.id ? pageTexts[entry.id] : undefined;
      if (texts)
        entry.keywords = [
          ...(entry.keywords ?? []),
          ...texts.map((message) => i18n._(message)),
        ];
    }

  return list;
}

export default Config;
