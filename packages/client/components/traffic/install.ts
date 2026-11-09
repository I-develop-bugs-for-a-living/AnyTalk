import { wrapFetch } from "./fetchWrapper";
import type { TrafficRecorder } from "./recorder";
import { wrapWebSocket } from "./wsWrapper";
import { wrapXhr } from "./xhrWrapper";

/** Marker on the global object so installing twice does nothing. */
const INSTALLED = Symbol.for("anytalk.trafficInspector.installed");

/**
 * Replace the global `fetch`, `XMLHttpRequest` and `WebSocket` with recording
 * wrappers. Safe to call more than once; later calls do nothing. Wrappers pass
 * straight through while `recorder.enabled` is false.
 *
 * @param recorder Where entries go
 * @param target Global object to patch, replaceable in tests
 * @returns Whether the wrappers were installed by this call
 */
export function installWrappers(
  recorder: TrafficRecorder,
  target: typeof globalThis = globalThis,
): boolean {
  const marked = target as unknown as Record<symbol, unknown>;
  if (marked[INSTALLED]) return false;
  marked[INSTALLED] = true;

  if (typeof target.fetch === "function") {
    target.fetch = wrapFetch(target.fetch, recorder);
  }
  if (typeof target.XMLHttpRequest === "function") {
    wrapXhr(target.XMLHttpRequest, recorder);
  }
  if (typeof target.WebSocket === "function") {
    target.WebSocket = wrapWebSocket(target.WebSocket, recorder);
  }
  return true;
}
