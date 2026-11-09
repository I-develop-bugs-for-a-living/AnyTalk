import type { TrafficRecorder } from "./recorder";
import { hostOf } from "./summarize";

/**
 * Start a `PerformanceObserver` that records browser-made loads (images,
 * video, iframes, ...) as `resource` entries. Returns a function that stops it,
 * or a no-op where the API is missing.
 *
 * @param recorder Where entries go
 */
export function observeResources(recorder: TrafficRecorder): () => void {
  if (
    typeof PerformanceObserver === "undefined" ||
    typeof performance === "undefined"
  ) {
    return () => {};
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        try {
          const entry = raw as PerformanceResourceTiming;
          recorder.record({
            kind: "resource",
            url: entry.name,
            host: hostOf(entry.name),
            initiatorType: entry.initiatorType,
            start: Math.round(performance.timeOrigin + entry.startTime),
            durationMs: Math.round(entry.duration),
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
            protocol: entry.nextHopProtocol,
            status: entry.responseStatus || undefined,
          });
        } catch {
          // recording must not matter
        }
      }
    });
    observer.observe({ type: "resource" });
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}
