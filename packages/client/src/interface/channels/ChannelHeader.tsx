import {
  Accessor,
  createEffect,
  createSignal,
  Match,
  on,
  onCleanup,
  Setter,
  Show,
  Switch,
} from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { Channel } from "stoat.js";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useDevice } from "@revolt/common";
import { TextWithEmoji } from "@revolt/markdown";
import { useModals } from "@revolt/modal";
import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import {
  Button,
  IconButton,
  NonBreakingText,
  OverflowingText,
  Spacer,
  typography,
  UserStatus,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import MdGroup from "@material-design-icons/svg/outlined/group.svg?component-solid";
import MdPersonAdd from "@material-design-icons/svg/outlined/person_add.svg?component-solid";
import MdSettings from "@material-design-icons/svg/outlined/settings.svg?component-solid";

import MdKeep from "../../svg/keep.svg?component-solid";
import { HeaderIcon } from "../common/CommonHeader";

import { searchScope } from "./text/SearchScopeSwitch";
import { canIHasSidebar, SidebarState } from "./text/TextChannel";

interface Props {
  /**
   * Channel to render header for
   */
  channel: Channel;

  /**
   * Sidebar state
   */
  sidebarState?: Accessor<SidebarState>;

  /**
   * Set sidebar state
   */
  setSidebarState?: Setter<SidebarState>;
}

/**
 * Common channel header component
 */
export function ChannelHeader(props: Props) {
  const { openModal } = useModals();
  const client = useClient();
  const { t } = useLingui();
  const state = useState();
  const voice = useVoice();
  const { layout } = useDevice();

  /**
   * Search placeholder naming the channel: "#name" for server channels,
   * plain name for DMs and groups
   */
  const searchPlaceholder = () => {
    if (props.channel.serverId && searchScope() === "server") {
      const serverName = props.channel.server?.name;
      if (serverName) return t`Search in ${serverName}`;
    }
    const name = props.channel.displayName ?? props.channel.name;
    if (!name) return t`Search messages...`;
    return props.channel.serverId
      ? t`Search in #${name}`
      : t`Search in ${name}`;
  };

  let searchInput: HTMLInputElement | undefined;
  let focusOnMount = false;

  // whether the latest pointer press landed inside the search panel or on one
  // of the header's panel buttons (pins, members): closing the empty panel then would shift the layout under the
  // pointer (the header resizes) and swallow the click, e.g. on pins/members
  let pointerInPanel = false;
  const trackPointer = (e: PointerEvent) => {
    pointerInPanel = !!(e.target as Element | null)?.closest?.(
      "[data-search-panel], [data-sidebar-toggle]",
    );
  };
  document.addEventListener("pointerdown", trackPointer, true);
  onCleanup(() =>
    document.removeEventListener("pointerdown", trackPointer, true),
  );

  /** Whether the sidebar shows search with nothing typed yet */
  const isEmptySearch = () => {
    const state = props.sidebarState?.();
    return state?.state === "search" && !state.query;
  };

  /**
   * Text in the search box. Kept apart from the sidebar state so it survives
   * switching to the pins or members panel.
   */
  const [searchText, setSearchText] = createSignal("");
  createEffect(
    on(
      () => props.sidebarState?.(),
      (state) => {
        // adopt a query set from outside (e.g. the phone search icon)
        if (state?.state === "search" && state.query)
          setSearchText(state.query);
      },
    ),
  );

  /**
   * Show the search panel for the text in the box (empty state when empty),
   * whichever panel is open
   */
  const openSearch = () => {
    if (props.sidebarState?.().state !== "search")
      props.setSidebarState?.({ state: "search", query: searchText() });
  };

  /** Take focus out of the search box so typing doesn't go into it */
  const leaveSearchBox = () => searchInput?.blur();

  /** Close the search panel again if nothing was typed */
  const closeEmptySearch = () => {
    if (isEmptySearch()) props.setSidebarState?.({ state: "default" });
  };

  // keyboard focus stays in the box when switching channels: reopen the panel
  createEffect(
    on(
      () => props.channel.id,
      () => {
        // the box is cleared with the sidebar state when changing channel
        setSearchText("");
        if (searchInput && document.activeElement === searchInput) openSearch();
      },
      { defer: true },
    ),
  );

  const searchValue = () => {
    if (!props.sidebarState) return null;

    const state = props.sidebarState();
    if (state.state === "search") return state.query;
    return "";
  };

  return (
    <>
      <Switch>
        <Match
          when={
            props.channel.type === "TextChannel" ||
            props.channel.type === "Group"
          }
        >
          <HeaderIcon>
            <Symbol>grid_3x3</Symbol>
          </HeaderIcon>
          <NonBreakingText
            class={
              typography({ class: "title", size: "medium" }) +
              " " +
              mobileOverflow
            }
            onClick={() =>
              openModal({
                type: "channel_info",
                channel: props.channel,
              })
            }
          >
            <TextWithEmoji content={props.channel.name!} />
          </NonBreakingText>
          <Show when={layout() !== "phone" && props.channel.description}>
            <Divider />
            <a
              class={descriptionLink}
              onClick={() =>
                openModal({
                  type: "channel_info",
                  channel: props.channel,
                })
              }
              use:floating={{
                tooltip: {
                  placement: "bottom",
                  content: t`Click to show full description`,
                },
              }}
            >
              <OverflowingText
                class={typography({ class: "title", size: "small" })}
              >
                <TextWithEmoji
                  content={props.channel.description?.split("\n").shift()}
                />
              </OverflowingText>
            </a>
          </Show>
        </Match>
        <Match when={props.channel.type === "DirectMessage"}>
          <HeaderIcon>
            <Symbol>alternate_email</Symbol>
          </HeaderIcon>
          <OverflowingText>
            <TextWithEmoji content={props.channel.recipient?.username} />
          </OverflowingText>
          <UserStatus status={props.channel.recipient?.presence} size="8px" />
        </Match>
        <Match when={props.channel.type === "SavedMessages"}>
          <HeaderIcon>
            <Symbol>note_stack</Symbol>
          </HeaderIcon>
          <Trans>Saved Notes</Trans>
        </Match>
      </Switch>

      <Spacer />

      <Show when={props.channel.isVoice && !voice.showCard(props.channel)}>
        <IconButton
          onPress={() => voice.connect(props.channel)}
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`Join the voice channel`,
            },
          }}
        >
          <Symbol>call</Symbol>
        </IconButton>
      </Show>

      <Show
        when={
          (props.channel.type === "Group" || props.channel.serverId) &&
          props.channel.orPermission("ManageChannel", "ManagePermissions")
        }
      >
        <IconButton
          onPress={() =>
            openModal({
              type: "settings",
              config: "channel",
              context: props.channel,
            })
          }
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`Channel Settings`,
            },
          }}
        >
          <MdSettings />
        </IconButton>
      </Show>

      <Show when={props.channel.type === "Group"}>
        <Button
          variant="text"
          size="icon"
          onPress={() =>
            openModal({
              type: "add_members_to_group",
              group: props.channel,
              client: client(),
            })
          }
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`Add friends to group`,
            },
          }}
        >
          <MdPersonAdd />
        </Button>
      </Show>

      <Show when={props.sidebarState}>
        <span data-sidebar-toggle class={css({ display: "contents" })}>
          <IconButton
            use:floating={{
              tooltip: {
                placement: "bottom",
                content: t`View pinned messages`,
              },
            }}
            onPress={() => {
              leaveSearchBox();
              props.setSidebarState!(
                props.sidebarState!().state === "pins"
                  ? { state: "default" }
                  : { state: "pins" },
              );
            }}
          >
            <MdKeep />
          </IconButton>
        </span>
      </Show>

      <Show when={props.sidebarState && canIHasSidebar(props.channel)}>
        <span data-sidebar-toggle class={css({ display: "contents" })}>
          <IconButton
            onPress={() => {
              leaveSearchBox();
              if (props.sidebarState!().state === "default") {
                state.layout.toggleSectionState(
                  LAYOUT_SECTIONS.MEMBER_SIDEBAR,
                  true,
                );
              } else {
                state.layout.setSectionState(
                  LAYOUT_SECTIONS.MEMBER_SIDEBAR,
                  true,
                  true,
                );

                props.setSidebarState!({
                  state: "default",
                });
              }
            }}
            use:floating={{
              tooltip: {
                placement: "bottom",
                content: t`View members`,
              },
            }}
          >
            <MdGroup />
          </IconButton>
        </span>
      </Show>

      <Show when={searchValue() !== null}>
        <Show
          when={
            layout() === "desktop" || props.sidebarState!().state !== "default"
          }
          fallback={
            <IconButton
              onPress={() => {
                focusOnMount = true;
                props.setSidebarState!({ state: "search", query: "" });
              }}
              use:floating={{
                tooltip: {
                  placement: "bottom",
                  content: t`Search`,
                },
              }}
            >
              <Symbol>search</Symbol>
            </IconButton>
          }
        >
          <SearchBox
            placeholder={searchPlaceholder()}
            aria-label={searchPlaceholder()}
            value={searchText()}
            ref={(el) => {
              searchInput = el;
              // opened with the search icon (phone): start typing right away
              if (focusOnMount) {
                focusOnMount = false;
                queueMicrotask(() => el.focus());
              }
            }}
            onFocus={openSearch}
            onInput={(e) => {
              setSearchText(e.currentTarget.value);
              // typing while pins/members is open switches back to search
              if (props.sidebarState!().state !== "search")
                props.setSidebarState!({ state: "search", query: "" });
            }}
            onBlur={(e) => {
              if (e.currentTarget.value) return;
              const input = e.currentTarget;
              // defer: tapping inside the panel must not close it, and on
              // iOS buttons don't take focus so relatedTarget can be null
              requestAnimationFrame(() => {
                if (
                  pointerInPanel ||
                  document.activeElement === input ||
                  document.activeElement?.closest("[data-search-panel]")
                )
                  return;
                closeEmptySearch();
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.isComposing && isEmptySearch()) {
                closeEmptySearch();
                e.currentTarget.blur();
              }
            }}
            onChange={(e) =>
              e.currentTarget.value
                ? props.setSidebarState!({
                    state: "search",
                    query: e.currentTarget.value,
                  })
                : props.setSidebarState!({
                    state: "default",
                  })
            }
          />
        </Show>
      </Show>
    </>
  );
}

const SearchBox = styled("input", {
  base: {
    height: "40px",
    width: "240px",
    paddingInline: "16px",
    borderRadius: "var(--borderRadius-full)",
    background: "var(--md-sys-color-surface-container-high)",
  },
});

/**
 * Vertical divider between name and topic
 */
const Divider = styled("div", {
  base: {
    height: "20px",
    margin: "0px 5px",
    paddingInlineStart: "1px",
    backgroundColor: "var(--md-sys-color-outline-variant)",
  },
});

/**
 * Link for the description
 */
const descriptionLink = css({
  minWidth: 0,
});

const mobileOverflow = css({
  _phone: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});
