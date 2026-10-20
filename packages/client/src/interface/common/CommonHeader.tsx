import { BiRegularChevronLeft, BiRegularChevronRight } from "solid-icons/bi";

import { JSX, Match, Switch } from "solid-js";

import MdArrowBack from "@material-design-icons/svg/outlined/arrow_back.svg?component-solid";

import { useLingui } from "@lingui/solid/macro";
import { css } from "styled-system/css";

import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import { useRailHidden } from "../navigation/servers/railMode";

/**
 * Wrapper for header icons which adds the chevron on the
 * correct side for toggling sidebar (if on desktop) and
 * the hamburger icon to open sidebar (if on mobile).
 */
export function HeaderIcon(props: { children: JSX.Element }) {
  const state = useState();
  const { t } = useLingui();
  // false on phones and in drawer mode, which always keep the server list
  const railHidden = useRailHidden();

  return (
    <div
      class={container}
      role="button"
      tabindex="0"
      aria-label={railHidden() ? t`Show server list` : t`Toggle main sidebar`}
      onClick={() => {
        const ad = state.appDrawer();
        if (ad) ad.setShown(false);
        else if (railHidden()) {
          // the only way back to the server list, so also reopen the channel sidebar
          state.layout.setSectionState(LAYOUT_SECTIONS.RAIL_HIDDEN, false);
          state.layout.setSectionState(
            LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
            true,
            true,
          );
        } else
          state.layout.toggleSectionState(
            LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
            true,
          );
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
      use:floating={{
        tooltip: {
          placement: "bottom",
          content: railHidden() ? t`Show server list` : t`Toggle main sidebar`,
        },
      }}
    >
      <Switch
        fallback={
          <>
            <BiRegularChevronRight size={20} />
            {props.children}
          </>
        }
      >
        <Match when={state.appDrawer()}>
          <MdArrowBack class="rtl-mirror" />
        </Match>
        <Match
          when={
            state.layout.getSectionState(
              LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
              true,
            ) && !railHidden()
          }
        >
          <BiRegularChevronLeft size={20} />
          {props.children}
        </Match>
      </Switch>
    </div>
  );
}

const container = css({
  display: "flex",
  cursor: "pointer",
  alignItems: "center",
});
