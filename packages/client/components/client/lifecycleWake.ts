import type { State } from "./Controller";

/** Lifecycle state name, e.g. "Connected" */
type StateName = `${State}`;

/**
 * What the connection lifecycle should do when the network or the tab wakes up.
 * - `retry`: leave the backoff wait and reconnect now
 * - `deviceOnline`: leave the offline state and reconnect now
 * - `dropSocket`: the device went offline while connected, close the dead socket
 */
export type WakeAction = "retry" | "deviceOnline" | "dropSocket";

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

/**
 * Decide whether to drop the socket when the tab becomes visible again. A tab
 * hidden for longer than the heartbeat interval may hold a frozen socket, so
 * we reconnect right away instead of waiting for the heartbeat to notice.
 * @param state Name of the current lifecycle state
 * @param hiddenForMs How long the tab was hidden, in milliseconds
 */
export function actionOnVisible(
  state: StateName,
  hiddenForMs: number,
): WakeAction | undefined {
  if (state === "Connected" && hiddenForMs > HIDDEN_DROP_AFTER_MS) {
    return "dropSocket";
  }
  return undefined;
}
