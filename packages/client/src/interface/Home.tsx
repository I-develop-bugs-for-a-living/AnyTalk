import { Match, Show, Switch, createMemo, onMount } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { PublicChannelInvite } from "stoat.js";
import { css, cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import {
  clearUpdateFailed,
  desktopNoticeDismissed,
  dismissDesktopNotice,
  pickUpdateNotice,
  runUpdate,
  updateBusy,
  updateFailed,
  updaterState,
  watchUpdater,
} from "@revolt/app/interface/settings/user/updaterState";
import { useClient } from "@revolt/client";
import { useInstance } from "@revolt/instance";
import { useModals } from "@revolt/modal";
import { useNavigate } from "@revolt/routing";
import { useState } from "@revolt/state";
import {
  Button,
  CategoryButton,
  Column,
  Header,
  IconButton,
  Text,
  iconSize,
  main,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import MdAddCircle from "@material-design-icons/svg/filled/add_circle.svg?component-solid";
import MdExplore from "@material-design-icons/svg/filled/explore.svg?component-solid";
import MdGridView from "@material-design-icons/svg/filled/grid_view.svg?component-solid";
import MdGroup from "@material-design-icons/svg/filled/group.svg?component-solid";
import MdGroups3 from "@material-design-icons/svg/filled/groups_3.svg?component-solid";
import MdHome from "@material-design-icons/svg/filled/home.svg?component-solid";
import MdSettings from "@material-design-icons/svg/filled/settings.svg?component-solid";

import Wordmark from "../../public/assets/web/wordmark.svg?component-solid";
import {
  applyUpdate,
  dismissUpdateNotice,
  noticeDismissed,
  updateAvailable,
} from "../serviceWorkerInterface";
import { HeaderIcon } from "./common/CommonHeader";

import { FriendsOverview } from "./home/FriendsOverview";

/**
 * Base layout of the home page (i.e. the header/background)
 */
const Base = styled("div", {
  base: {
    width: "100%",
    display: "flex",
    flexDirection: "column",

    color: "var(--md-sys-color-on-surface)",
  },
});

/**
 * Layout of the content as a whole
 */
const content = cva({
  base: {
    ...main.raw(),

    padding: "48px 0",

    gap: "32px",
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * Layout of the buttons
 */
const Buttons = styled("div", {
  base: {
    gap: "8px",
    padding: "8px",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    borderRadius: "var(--borderRadius-lg)",

    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-variant)",
  },
});

/**
 * Make sure the columns are separated
 */
const SeparatedColumn = styled(Column, {
  base: {
    justifyContent: "stretch",
    marginInline: "0.25em",
    width: "260px",
    "& > *": {
      flexGrow: 1,
    },
  },
});

/**
 * Highlighted card announcing a new version of the app
 */
const UpdateNotice = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px 12px",
    padding: "12px 12px 12px 16px",
    alignSelf: "center",
    boxSizing: "border-box",
    width: "min(560px, calc(100% - 32px))",
    borderRadius: "var(--borderRadius-lg)",

    color: "var(--md-sys-color-on-primary-container)",
    background: "var(--md-sys-color-primary-container)",
  },
});

/**
 * Text part of the update notice, takes the free space
 */
const UpdateNoticeText = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flex: "1 1 200px",
    minWidth: 0,
  },
});

/**
 * Home page as a route (content pane)
 */
export function HomePage() {
  return <HomePageContent />;
}

/**
 * Content of the home page
 *
 * `embedded` is the Home tab of the phone bottom bar: the page sits in the
 * sidebar pane, so the header has no back arrow, a Friends button is added
 * and every link also slides the content pane over the list.
 */
export function HomePageContent(props: { embedded?: boolean }) {
  const { openModal } = useModals();
  const navigate = useNavigate();
  const client = useClient();
  const instance = useInstance();
  const state = useState();
  const { t } = useLingui();

  /**
   * Open a page; on phones this also brings the content pane forward
   * @param path Route to open
   */
  const go = (path: string) => {
    navigate(path);
    state.appDrawer()?.setShown(true);
  };

  // follow the desktop updater (safe to call repeatedly, no-op in the browser)
  onMount(watchUpdater);

  // which update card to show, if any (respects the setting and dismissals)
  const notice = createMemo(() => {
    if (!state.settings.getValue("advanced:update_notice")) return undefined;
    return pickUpdateNotice(
      updaterState(),
      desktopNoticeDismissed(),
      updateAvailable() && !noticeDismissed(),
    );
  });

  /** Download progress of the desktop update, rounded for display */
  const percentValue = () => Math.round(updaterState()?.percent ?? 0);

  /** Text of the card while the desktop update downloads */
  const downloadingText = () => {
    const percent = percentValue();
    return t`Downloading the AnyTalk update (${percent}%)`;
  };

  /** Whether the open card is the desktop update with this action */
  const desktopAction = (action: string) => {
    const current = notice();
    return current?.type === "desktop" && current.action === action;
  };

  // check if we're stoat.chat; if so, check if the user is in the Lounge
  const showLoungeButton = instance.isStoat;
  const isInLounge =
    client()!.servers.get("01F7ZSBSFHQ8TA81725KQCSDDP") !== undefined;

  return (
    <Base>
      <Header placement="primary">
        <Show
          when={props.embedded}
          fallback={
            <HeaderIcon>
              <MdHome {...iconSize(22)} />
            </HeaderIcon>
          }
        >
          <MdHome {...iconSize(22)} />
        </Show>
        <Trans>Home</Trans>
      </Header>
      <div use:scrollable={{ class: content() }}>
        <Show when={notice()}>
          <UpdateNotice role="alert">
            <UpdateNoticeText>
              <Symbol aria-hidden="true">system_update</Symbol>
              <Text class="body" size="large">
                <span role="status" aria-live="polite">
                  <Switch>
                    <Match when={updateFailed()}>
                      <Trans>
                        The update could not be started. Try again or use
                        Settings, Updates.
                      </Trans>
                    </Match>
                    <Match when={desktopAction("restart")}>
                      <Trans>An AnyTalk desktop update is ready</Trans>
                    </Match>
                    <Match when={desktopAction("download")}>
                      <Trans>An AnyTalk desktop update is available</Trans>
                    </Match>
                    <Match when={desktopAction("downloading")}>
                      {downloadingText()}
                    </Match>
                    <Match when={desktopAction("retry")}>
                      <Trans>The AnyTalk update could not be downloaded</Trans>
                    </Match>
                    <Match when={!!window.native}>
                      <Trans>New AnyTalk web version available</Trans>
                    </Match>
                    <Match when={true}>
                      <Trans>A new version of AnyTalk is available</Trans>
                    </Match>
                  </Switch>
                </span>
              </Text>
              <Show when={desktopAction("downloading")}>
                {/* native element, so screen readers announce the value */}
                <progress
                  class={css({
                    width: "80px",
                    height: "8px",
                    flexShrink: 0,
                    accentColor: "var(--md-sys-color-primary)",
                  })}
                  max={100}
                  value={percentValue()}
                  aria-label={t`Download progress`}
                />
              </Show>
            </UpdateNoticeText>
            <Button
              variant="filled"
              isDisabled={updateBusy() || desktopAction("downloading")}
              onPress={() => {
                const current = notice();
                if (current) runUpdate(current, applyUpdate);
              }}
            >
              <Switch fallback={<Trans>Update now</Trans>}>
                <Match when={desktopAction("downloading")}>
                  <Trans>Downloading...</Trans>
                </Match>
                <Match when={updateBusy()}>
                  <Trans>Updating...</Trans>
                </Match>
                <Match when={desktopAction("restart")}>
                  <Trans>Restart to update</Trans>
                </Match>
                <Match when={desktopAction("download")}>
                  <Trans>Download update</Trans>
                </Match>
                <Match when={desktopAction("retry")}>
                  <Trans>Retry download</Trans>
                </Match>
                <Match when={!!window.native}>
                  <Trans>Reload</Trans>
                </Match>
              </Switch>
            </Button>
            <IconButton
              variant="standard"
              aria-label={t`Dismiss`}
              onPress={() => {
                clearUpdateFailed();
                if (notice()?.type === "desktop") dismissDesktopNotice();
                else dismissUpdateNotice();
              }}
            >
              <Symbol aria-hidden="true">close</Symbol>
            </IconButton>
          </UpdateNotice>
        </Show>
        <Column>
          <Wordmark
            class={css({
              width: "160px",
              fill: "var(--md-sys-color-on-surface)",
            })}
          />
        </Column>
        <FriendsOverview />
        <Buttons>
          <SeparatedColumn>
            <CategoryButton
              onClick={() =>
                openModal({
                  type: "create_group_or_server",
                  client: client()!,
                })
              }
              description={
                <Trans>
                  Invite all of your friends, some cool bots, and throw a big
                  party.
                </Trans>
              }
              icon={<MdAddCircle />}
            >
              <Trans>Create a group or server</Trans>
            </CategoryButton>
            <Switch fallback={null}>
              <Match when={showLoungeButton && isInLounge}>
                <CategoryButton
                  onClick={() => go("/server/01F7ZSBSFHQ8TA81725KQCSDDP")}
                  description={
                    <Trans>
                      You can report issues and discuss improvements with us
                      directly here.
                    </Trans>
                  }
                  icon={<MdGroups3 />}
                >
                  <Trans>Go to the AnyTalk Lounge</Trans>
                </CategoryButton>
              </Match>
              <Match when={showLoungeButton && !isInLounge}>
                <CategoryButton
                  onClick={() => {
                    client()
                      .api.get("/invites/Testers")
                      .then((invite) =>
                        PublicChannelInvite.from(client(), invite),
                      )
                      .then((invite) => openModal({ type: "invite", invite }));
                  }}
                  description={
                    <Trans>
                      You can report issues and discuss improvements with us
                      directly here.
                    </Trans>
                  }
                  icon={<MdGroups3 />}
                >
                  <Trans>Join the AnyTalk Lounge</Trans>
                </CategoryButton>
              </Match>
            </Switch>
          </SeparatedColumn>
          <SeparatedColumn>
            <Show when={instance.isStoat}>
              <CategoryButton
                onClick={() => go("/discover")}
                description={
                  <Trans>
                    Find a community based on your hobbies or interests.
                  </Trans>
                }
                icon={<MdExplore />}
              >
                <Trans>Discover AnyTalk</Trans>
              </CategoryButton>
            </Show>
            <Show when={props.embedded}>
              <CategoryButton
                onClick={() => go("/friends")}
                description={
                  <Trans>See your friends and answer friend requests.</Trans>
                }
                icon={<MdGroup />}
              >
                <Trans>Friends</Trans>
              </CategoryButton>
            </Show>
            <CategoryButton
              onClick={() => go("/servers")}
              description={<Trans>See all your servers at a glance.</Trans>}
              icon={<MdGridView />}
            >
              <Trans>Server overview</Trans>
            </CategoryButton>
            <CategoryButton
              onClick={() => openModal({ type: "settings", config: "user" })}
              description={
                <Trans>
                  You can also click the gear icon in the bottom left.
                </Trans>
              }
              icon={<MdSettings />}
            >
              <Trans>Open settings</Trans>
            </CategoryButton>
          </SeparatedColumn>
        </Buttons>
      </div>
    </Base>
  );
}
