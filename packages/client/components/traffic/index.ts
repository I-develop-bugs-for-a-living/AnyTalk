import {
  clear,
  entries,
  installTrafficInspector,
  recording,
  setRecording,
  setShowSecrets,
  showSecrets,
  watchCallTraffic,
} from "./state";

export { buildHar, buildJson } from "./export";
export {
  fileStamp,
  formatBytes,
  formatClock,
  formatDuration,
  tlsVersionName,
} from "./format";
export { redactEntry } from "./redact";
export { describeRow } from "./rows";
export type { RowBadge, RowEvent, RowRoute, RowSummary } from "./rows";
export type {
  BodySummary,
  CallAttributeEntry,
  CallBytesEntry,
  CallConnectionEntry,
  CallDataEntry,
  CallEntry,
  CallInfoEntry,
  HeaderList,
  HttpEntry,
  ResourceEntry,
  TrafficEntry,
  WsEntry,
} from "./types";
export {
  entryDuration,
  entryHost,
  entrySize,
  entryTime,
  filterEntries,
  hideCallNoise,
  kindGroup,
  pauseCutoff,
  remoteOf,
  summarizeDestinations,
  upToId,
} from "./view";
export type { Destination, DestinationType, KindGroup } from "./view";
export {
  clear,
  entries,
  installTrafficInspector,
  recording,
  setRecording,
  setShowSecrets,
  showSecrets,
  watchCallTraffic,
};

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
