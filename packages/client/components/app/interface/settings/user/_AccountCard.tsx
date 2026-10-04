import { Trans } from "@lingui/solid/macro";

import { Show } from "solid-js";

import { useClient } from "@revolt/client";
import { useDevice } from "@revolt/common";
import { Avatar, OverflowingText, Ripple, typography } from "@revolt/ui";

import MdArrowBack from "@material-design-icons/svg/outlined/arrow_back.svg?component-solid";

import { css } from "styled-system/css";
import { useSettingsNavigation } from "../Settings";
import {
  SidebarButton,
  SidebarButtonContent,
  SidebarButtonTitle,
} from "../_layout/SidebarButton";

/**
 * Account Card
 */
export function AccountCard() {
  const client = useClient();
  const { page, navigate } = useSettingsNavigation();

  return (
    <SidebarButton
      class="account"
      onClick={() => navigate("account")}
      aria-selected={page() === "account"}
    >
      <Ripple />
      <SidebarButtonTitle>
        <Avatar size={36} src={client().user!.animatedAvatarURL} />
        <SidebarButtonContent>
          <OverflowingText
            class={typography({ class: "label", size: "small" })}
          >
            {client().user!.displayName}
          </OverflowingText>
          <Trans>My Account</Trans>
        </SidebarButtonContent>
      </SidebarButtonTitle>
      {/*<SidebarButtonIcon>
        <MdError {...iconSize(20)} fill={theme!.colour("primary")} />
      </SidebarButtonIcon>*/}
    </SidebarButton>
  );
}

export function BackCard(props: { onClose?: () => void }) {
  const device = useDevice();

  return (
    // phones have a close button at the top instead
    <Show when={device.layout() !== "phone"}>
      <SidebarButton
        class={"back " + mobileOnly}
        onClick={props.onClose}
        noDrawer
      >
        <Ripple />
        <SidebarButtonTitle>
          <MdArrowBack class="rtl-mirror" />
          <SidebarButtonContent>
            <Trans>Back</Trans>
          </SidebarButtonContent>
        </SidebarButtonTitle>
      </SidebarButton>
    </Show>
  );
}

const mobileOnly = css({
  display: "none",
  _tablet: { display: "flex" },
});
