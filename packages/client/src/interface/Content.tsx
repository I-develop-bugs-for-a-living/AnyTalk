import { Component, Match, Show, Switch } from "solid-js";

import { isHomeRoute } from "@revolt/common/lib/phoneTabs";
import Instance from "@revolt/instance/Instance";
import { useLocation, useParams } from "@revolt/routing";

import { HomePage } from "./Home";
import { ServerHome } from "./ServerHome";
import { ChannelPage } from "./channels/ChannelPage";
import { useBottomNav } from "./navigation/bottomNav/useBottomNav";

/**
 * Render content without sidebars
 */
export const Content: Component = () => {
  const params = useParams<{
    server?: string;
    channel?: string;
    any?: string;
  }>();

  const bottomNav = useBottomNav();
  const location = useLocation();

  // with the bottom bar the Home tab shows the home page in the sidebar pane,
  // so this pane renders nothing there instead of a second copy
  const homeInTab = () =>
    bottomNav() && isHomeRoute(Instance.relPath(location.pathname));

  return (
    <Switch
      fallback={
        <Show when={!homeInTab()}>
          <HomePage />
        </Show>
      }
    >
      <Match when={params.channel}>
        <ChannelPage />
      </Match>
      <Match when={params.server}>
        <ServerHome />
      </Match>
    </Switch>
  );

  /*return (
    <>
      <Route
        path="/server/:server/*"
        element={
          <>
            <Route path="/channel/:channel/*" component={ChannelPage} />
            <Route path="/*" component={ServerHome} />
          </>
        }
      />
      <Route path="/channel/:channel/*" component={ChannelPage} />
      <Route path="/friends" component={Friends} />
      <Route path="/app" component={HomePage} />
      <Route path="/" element={<Navigate href="/app" />} />
    </>
  );*/
};
