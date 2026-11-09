import type { Server } from "stoat.js";

import { KeybindAction, createKeybind } from "@revolt/keybinds";
import { useNavigate } from "@revolt/routing";

/**
 * Register the keybinds that move to the previous and next server. Going up
 * from the first server leads to Home, the list wraps around at the end.
 * Call once per app; the server rail does on desktop, the phone bottom bar
 * does on phones.
 * @param servers Ordered servers
 * @param selectedServer ID of the open server, if any
 */
export function createServerKeybinds(
  servers: () => Server[],
  selectedServer: () => string | undefined,
) {
  const navigate = useNavigate();

  /**
   * Open the server a number of steps away from the current one
   * @param byOffset Steps, -1 for previous and 1 for next
   */
  const navigateServer = (byOffset: number) => {
    const list = servers();
    const serverId = selectedServer();
    if (serverId == null && list.length) {
      navigate(
        `/server/${(byOffset === 1 ? list[0] : list[list.length - 1]).id}`,
      );
      return;
    }

    const nextIndex =
      list.findIndex((server) => server.id === serverId) + byOffset;

    if (nextIndex === -1) {
      return navigate("/app");
    }

    // this will wrap the index around
    const nextServer = list.at(nextIndex % list.length);

    if (nextServer) {
      navigate(`/server/${nextServer.id}`);
    }
  };

  createKeybind(KeybindAction.NAVIGATION_SERVER_UP, () => navigateServer(-1));
  createKeybind(KeybindAction.NAVIGATION_SERVER_DOWN, () => navigateServer(1));
}
