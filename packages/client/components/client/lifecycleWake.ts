import type { State } from "./Controller";

/** Lifecycle state name, e.g. "Connected" */
type StateName = `${State}`;

/**
 * What the connection lifecycle should do when the network or the tab wakes up.
 * - `retry`: leave the backoff wait and reconnect now
 * - `deviceOnline`: leave the offline state and reconnect now
 * - `dropSocket`: the device went offline while connected, close the dead socket
 * - `probeSocket`: the tab was hidden a long time, check the socket with a Ping
 */
export type WakeAction =
  | "retry"
  | "deviceOnline"
  | "dropSocket"
  | "probeSocket";

/**
 * Decide what to do when the browser comes back online or the tab becomes visible.
 * Returns nothing while a connection is already being made or is healthy, so we
 * never open a second connection.
 * @param state Name of the current lifecycle state (e.g. "Disconnected")
 * @param online Whether the browser reports a network connection
 */
export function actionOnWake(
  state: StateName,
  online: boolean,
): WakeAction | undefined {
  if (!online) return undefined;
  if (state === "Disconnected") return "retry";
  if (state === "Offline") return "deviceOnline";
  return undefined;
}

/**
 * Decide what to do when the browser reports that the device went offline.
 * @param state Name of the current lifecycle state (e.g. "Connected")
 */
export function actionOnOffline(state: StateName): WakeAction | undefined {
  if (
    state === "Connected" ||
    state === "Connecting" ||
    state === "Reconnecting"
  ) {
    return "dropSocket";
  }
  return undefined;
}

/** Hidden for longer than this (ms) and a "connected" socket is suspect */
export const HIDDEN_DROP_AFTER_MS = 15_000;

/** How long (ms) to wait for a Pong before treating the socket as dead */
export const PROBE_TIMEOUT_MS = 3_000;

/**
 * Decide whether to check the socket when the tab becomes visible again. A tab
 * hidden for longer than the heartbeat interval may hold a frozen socket, so
 * we probe it (see `probeSocket`) instead of waiting for the heartbeat.
 * @param state Name of the current lifecycle state
 * @param hiddenForMs How long the tab was hidden, in milliseconds
 */
export function actionOnVisible(
  state: StateName,
  hiddenForMs: number,
): WakeAction | undefined {
  if (state === "Connected" && hiddenForMs > HIDDEN_DROP_AFTER_MS) {
    return "probeSocket";
  }
  return undefined;
}

/** Minimal view of the event client needed to probe the socket */
export interface ProbeTarget {
  /** Send a Ping to the server */
  send(event: { type: "Ping"; data: number }): void;
  /** Handle a server event; called for every incoming message */
  handle(event: { type: string; data?: unknown }): void;
  /** Close the socket */
  disconnect(): void;
}

/** Counter that keeps probe tokens unique */
let probeCounter = 0;

/**
 * Check that a socket still works by sending a Ping and waiting for the
 * matching Pong. Closes the socket only if no Pong arrives in time (or the
 * Ping cannot be sent), so a healthy connection stays untouched.
 * Cancel a running probe before starting a new one: the wrappers restore
 * `handle` in LIFO order.
 * @param target Event client to probe
 * @param timeoutMs How long to wait for the Pong
 * @param now Clock, replaceable in tests
 * @returns Function that cancels the probe
 */
export function probeSocket(
  target: ProbeTarget,
  timeoutMs = PROBE_TIMEOUT_MS,
  now: () => number = Date.now,
): () => void {
  // unique per probe so it cannot match a heartbeat Ping
  const token = now() * 1000 + (probeCounter++ % 1000);
  const originalHandle = target.handle;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    // only undo our wrapper if nobody replaced it meanwhile
    if (target.handle === wrapped) target.handle = originalHandle;
  };

  // watch incoming events for our Pong, then pass everything along
  const wrapped = function (event: Parameters<ProbeTarget["handle"]>[0]) {
    if (event.type === "Pong" && event.data === token) finish();
    return originalHandle.call(target, event);
  };
  target.handle = wrapped;

  const timer = setTimeout(() => {
    if (done) return;
    finish();
    target.disconnect();
  }, timeoutMs);

  try {
    target.send({ type: "Ping", data: token });
  } catch {
    // socket already gone
    finish();
    target.disconnect();
  }

  return finish;
}
