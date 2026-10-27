import {
  clear,
  entries,
  installTrafficInspector,
  recording,
  setRecording,
} from "./state";

export { redactEntry } from "./redact";
export type {
  BodySummary,
  HttpEntry,
  ResourceEntry,
  TrafficEntry,
  WsEntry,
} from "./types";
export { clear, entries, installTrafficInspector, recording, setRecording };

/**
 * Install the recording wrappers and, in development builds only, expose the
 * API as `window.__anytalkTraffic` for trying it from the console.
 */
export function startTrafficInspector() {
  installTrafficInspector();
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__anytalkTraffic = {
      recording,
      setRecording,
      entries,
      clear,
    };
  }
}
