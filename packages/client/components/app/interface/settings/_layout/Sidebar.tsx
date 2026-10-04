import { useLingui } from "@lingui/solid/macro";
import { Accessor, For, Setter, Show, createSignal, onMount } from "solid-js";

import { styled } from "styled-system/jsx";

import { useDevice } from "@revolt/common";
import { Column, IconButton, OverflowingText } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

// import MdError from "@material-design-icons/svg/filled/error.svg?component-solid";
// import MdOpenInNew from "@material-design-icons/svg/filled/open_in_new.svg?component-solid";
import { SettingsEntry, SettingsList } from "..";
import { useSettingsNavigation } from "../Settings";

import {
  SidebarButton,
  SidebarButtonContent,
  SidebarButtonTitle,
} from "./SidebarButton";

/**
 * Settings Sidebar Layout
 *
 * On phones it is the start screen: a title with a close button, a search
 * and the entries grouped into cards, each opening its page full screen
 */
export function SettingsSidebar(props: {
  list: Accessor<SettingsList<unknown>>;
  setPage: Setter<string | undefined>;
  page: Accessor<string | undefined>;
  onClose?: () => void;
}) {
  const { navigate } = useSettingsNavigation();
  const { t } = useLingui();
  const device = useDevice();
  const phone = () => device.layout() === "phone";

  const [query, setQuery] = createSignal("");
  const search = () => (phone() ? query().trim().toLocaleLowerCase() : "");

  /**
   * Select first page on load
   */
  onMount(() => {
    if (!props.page()) {
      props.setPage(props.list().entries[0].entries[0].id);
    }
  });

  return (
    <Base class="settings_sidebar">
      <div use:invisibleScrollable>
        <Content class="content">
          <Column gap="lg">
            <Show when={phone()}>
              <PhoneHeader>
                <Show when={props.onClose}>
                  <CloseButton>
                    <IconButton
                      variant="tonal"
                      onPress={props.onClose}
                      aria-label={t`Close`}
                    >
                      <Symbol>close</Symbol>
                    </IconButton>
                  </CloseButton>
                </Show>
                <PhoneTitle>{t`Settings`}</PhoneTitle>
                <SearchField>
                  <Symbol size={20}>search</Symbol>
                  <input
                    type="search"
                    placeholder={t`Search settings`}
                    aria-label={t`Search settings`}
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </SearchField>
              </PhoneHeader>
            </Show>
            <Show when={!search()}>{props.list().prepend}</Show>
            <For each={props.list().entries}>
              {(category) => (
                <Show when={!category.hidden}>
                  <Category class="settings_category">
                    <Show when={category.title && !search()}>
                      <CategoryTitle>{category.title}</CategoryTitle>
                    </Show>
                    <Group gap="s">
                      <For each={category.entries}>
                        {(entry) => (
                          <Entry
                            entry={entry}
                            search={search()}
                            phone={phone()}
                            selected={
                              props.page()?.split("/")[0] ===
                              entry.id?.split("/")[0]
                            }
                            onClick={() => {
                              setQuery("");
                              navigate(entry);
                            }}
                          />
                        )}
                      </For>
                    </Group>
                  </Category>
                </Show>
              )}
            </For>
            <Show when={search()}>
              <NoResults class="settings_no_results">
                {t`No settings found`}
              </NoResults>
            </Show>
            <Show when={!search()}>{props.list().append}</Show>
          </Column>
        </Content>
      </div>
    </Base>
  );
}

/**
 * Entry in the sidebar, hidden while a search doesn't match it
 */
function Entry(props: {
  entry: SettingsEntry;
  search: string;
  phone: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  let titleRef: HTMLSpanElement | undefined;
  const [title, setTitle] = createSignal("");
  onMount(() => setTitle(titleRef?.textContent?.toLocaleLowerCase() ?? ""));

  // a setting on the page that matched, shown below the entry
  const keyword = () =>
    props.search && !title().includes(props.search)
      ? props.entry.keywords?.find((keyword) =>
          keyword.toLocaleLowerCase().includes(props.search),
        )
      : undefined;

  const visible = () =>
    props.search
      ? title().includes(props.search) || !!keyword()
      : !props.entry.hidden;

  return (
    <div class="settings_entry" hidden={!visible()}>
      <SidebarButton onClick={props.onClick} aria-selected={props.selected}>
        <SidebarButtonTitle>
          {props.entry.icon}
          <SidebarButtonContent>
            <OverflowingText>
              <span ref={titleRef}>{props.entry.title}</span>
            </OverflowingText>
            <Show when={keyword()}>
              <Keyword>{keyword()}</Keyword>
            </Show>
          </SidebarButtonContent>
        </SidebarButtonTitle>
        <Show when={props.phone}>
          <Chevron>
            <Symbol size={20}>
              {props.entry.href ? "open_in_new" : "chevron_right"}
            </Symbol>
          </Chevron>
        </Show>
      </SidebarButton>
    </div>
  );
}

/**
 * Base layout of the sidebar
 */
const Base = styled("div", {
  base: {
    display: "flex",
    flex: "1 0 218px",
    paddingInlineStart: "8px",
    justifyContent: "flex-end",
    height: "100%",

    _phone: {
      position: "absolute",
      width: "100vw",
      paddingInlineStart: "12px",

      "& > *": {
        width: "100%",
      },
    },
  },
});

/**
 * Aligned content within the sidebar
 */
const Content = styled("div", {
  base: {
    minWidth: "230px",
    maxWidth: "300px",
    // the end of the list stays clear of the home indicator on iPhones
    padding: "74px 0 calc(8px + var(--safe-area-bottom))",
    display: "flex",
    gap: "2px",

    flexDirection: "column",

    "& a > div": {
      margin: 0,
    },

    // categories a search left empty
    "& .settings_category:not(:has(.settings_entry:not([hidden])))": {
      display: "none",
    },

    // only when nothing at all matched
    "&:has(.settings_entry:not([hidden])) .settings_no_results": {
      display: "none",
    },

    // also on phones, which are within the tablet breakpoint
    _tablet: {
      padding: "8px 0 calc(16px + var(--safe-area-bottom))",
    },
    _phone: {
      maxWidth: "unset",
      marginInlineEnd: "12px",

      // the account card is a card of its own
      "& .account": {
        minHeight: "72px",
        borderRadius: "16px",
        background: "var(--md-sys-color-surface-container)",
      },
    },
  },
});

/**
 * Title, close button and search at the top on phones
 */
const PhoneHeader = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

const CloseButton = styled("div", {
  base: {
    display: "flex",
    justifyContent: "flex-end",
  },
});

const PhoneTitle = styled("h1", {
  base: {
    margin: "0 4px",
    fontSize: "32px",
    lineHeight: "40px",
    fontWeight: 700,
    color: "var(--md-sys-color-on-surface)",
  },
});

const SearchField = styled("label", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minHeight: "48px",
    padding: "0 16px",
    borderRadius: "24px",
    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-container)",

    "&:focus-within": {
      outline: "2px solid var(--md-sys-color-primary)",
    },

    "& input": {
      flexGrow: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "none",
      color: "var(--md-sys-color-on-surface)",
      // 16px keeps iOS from zooming in on focus
      fontSize: "16px",
    },
  },
});

const Category = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
  },
});

/**
 * Entries of a category, a rounded card on phones
 */
const Group = styled(Column, {
  base: {
    _phone: {
      gap: 0,
      overflow: "hidden",
      borderRadius: "16px",
      background: "var(--md-sys-color-surface-container)",

      // a line between entries, leaving out hidden ones
      "& > .settings_entry:not([hidden]) ~ .settings_entry:not([hidden])": {
        borderTop: "1px solid var(--md-sys-color-outline-variant)",
      },

      "&:not(:has(.settings_entry:not([hidden])))": {
        display: "none",
      },
    },
  },
});

/**
 * Titles for each category
 */
const CategoryTitle = styled("span", {
  base: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",

    textTransform: "uppercase",
    fontSize: "0.75rem",
    fontWeight: 700,
    margin: "0 8px",
    marginInlineEnd: "20px",

    color: "var(--md-sys-color-outline)",

    _phone: {
      margin: "0 16px 8px",
    },
  },
});

/**
 * Setting that made the search find this entry
 */
const Keyword = styled("span", {
  base: {
    fontSize: "13px",
    fontWeight: 400,
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const Chevron = styled("span", {
  base: {
    display: "flex",
    color: "var(--md-sys-color-outline)",
  },
});

const NoResults = styled("p", {
  base: {
    margin: "24px 16px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
