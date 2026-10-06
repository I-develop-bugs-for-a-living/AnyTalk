import { createEffect, on, onCleanup } from "solid-js";

import { ProtocolV1 } from "stoat.js";

import { useClient, useClientLifecycle } from "@revolt/client";

import { State } from "@revolt/client/Controller";
import { useState } from ".";

/**
 * Manage synchronisation of settings to-from API
 */
export function SyncWorker() {
  const state = useState();
  const client = useClient();
  const { lifecycle } = useClientLifecycle();

  /**
   * Server ids the user was already in, plus ids a default was applied to.
   * Used to ignore duplicate ServerCreate events.
   */
  const knownServers = new Set<string>();

  /**
   * Apply the default notification setting once per server id
   * @param id Server id
   */
  function applyDefaultOnce(id: string) {
    if (knownServers.has(id)) return;
    knownServers.add(id);
    state.notifications.applyDefaultForNewServer(id);
  }

  /**
   * Handle incoming events
   * @param event Event
   */
  function handleEvent(event: ProtocolV1["server"]) {
    if (event.type === "UserSettingsUpdate") {
      state.sync.consumeEvent(event.update);
    } else if (event.type === "ServerCreate") {
      // created a server or was added to one (invite, discovery)
      applyDefaultOnce(event.server._id);
    } else if (
      event.type === "ServerMemberJoin" &&
      event.user === client().user?.id
    ) {
      applyDefaultOnce(event.id);
    }
  }

  /**
   * Handle events while the initial sync is running (settings updates only)
   * @param event Event
   */
  function handleSyncOnly(event: ProtocolV1["server"]) {
    if (event.type === "UserSettingsUpdate") {
      state.sync.consumeEvent(event.update);
    }
  }

  // sync REMOTE->LOCAL settings
  createEffect(
    on(
      () => lifecycle.state(),
      (newState) => {
        if (newState === State.Connected) {
          const current = client();
          let disposed = false;
          let attached = false;
          onCleanup(() => {
            disposed = true;
            if (attached) current.events.removeListener("event", handleEvent);
          });

          // snapshot servers the user is already in
          knownServers.clear();
          current.servers
            .toList()
            .forEach((server) => knownServers.add(server.id));

          // only apply defaults once the sync finished, otherwise a merge of
          // a newer remote blob could overwrite them
          current.events.addListener("event", handleSyncOnly);
          state.sync
            .initialSync(current)
            .catch(() => {})
            .finally(() => {
              current.events.removeListener("event", handleSyncOnly);
              if (disposed) return;
              current.events.addListener("event", handleEvent);
              attached = true;
            });
        }
      },
    ),
  );

  // sync LOCAL->REMOTE settings
  createEffect(
    on(
      [() => state.sync.shouldSync, lifecycle.state],
      ([shouldSync, newState]) =>
        shouldSync && newState === State.Connected && state.sync.save(client()),
    ),
  );

  return null;
}
