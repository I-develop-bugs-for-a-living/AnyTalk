import { createSignal } from "solid-js";

import { type CallRoomLike, monitorCall } from "./callTraffic";
import { observeDesktopRequests } from "./desktopRequests";
import { installWrappers } from "./install";
import { TrafficRecorder } from "./recorder";
import { redactEntry } from "./redact";
import { observeResources } from "./resources";
import type { TrafficEntry } from "./types";
import { mergeResources } from "./view";

/** The one recorder shared by the whole app. */
const recorder = new TrafficRecorder();

/** Whether recording is on, for reactive readers. */
const [recordingSignal, setRecordingSignal] = createSignal(false);
/** Bumped when entries change, so `entries()` re-runs. */
const [version, setVersion] = createSignal(0);

/** Stops the resource observer while recording is on. */
let stopResources: (() => void) | undefined;

/** Stops the desktop request feed while recording is on (desktop app only). */
let stopDesktop: (() => void) | undefined;

/** Pending flush of change notifications, so busy sockets don't thrash the UI. */
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** Counts recorder changes right away, to tell when cached results are stale. */
let generation = 0;

recorder.subscribe(() => {
  generation++;
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    setVersion((v) => v + 1);
  }, 100);
});

/**
 * Install the fetch, XMLHttpRequest and WebSocket wrappers once. Does not
 * start recording. Call before the stoat.js `Client` is created.
 */
export function installTrafficInspector() {
  installWrappers(recorder);
}

/**
 * Whether recording is on (reactive). Off at startup and never persisted.
 */
export function recording(): boolean {
  return recordingSignal();
}

/**
 * Turn recording on or off. Turning it on also starts the resource observer
 * and, in the desktop app, the feed of requests its session sees.
 * Recorded entries are kept when turned off, until `clear()` or a reload.
 *
 * @param value New state
 */
export function setRecording(value: boolean) {
  if (value === recorder.enabled) return;
  recorder.enabled = value;
  setRecordingSignal(value);
  if (value) {
    stopResources = observeResources(recorder);
    stopDesktop = observeDesktopRequests(recorder);
  } else {
    stopDesktop?.();
    stopDesktop = undefined;
    stopResources?.();
    stopResources = undefined;
  }
}

/** Redacted copies by stored entry (stored entries never change). */
const redactedCache = new WeakMap<TrafficEntry, TrafficEntry>();

/** The last list built by `entries()` and what it was built from. */
let cached:
  | { generation: number; secrets: boolean; result: TrafficEntry[] }
  | undefined;

/** Redact an entry once and reuse the copy, so rows keep their identity. */
function redactedOf(entry: TrafficEntry): TrafficEntry {
  let out = redactedCache.get(entry);
  if (!out) {
    out = redactEntry(entry);
    redactedCache.set(entry, out);
  }
  return out;
}

/** Whether tokens and keys are shown, in memory only (resets on reload). */
const [showSecretsSignal, setShowSecretsSignal] = createSignal(false);

/**
 * Whether tokens and keys are shown on screen and in exports (reactive). Off
 * at startup and never persisted.
 */
export function showSecrets(): boolean {
  return showSecretsSignal();
}

/**
 * Show or hide tokens and keys in the inspector and its exports.
 *
 * @param value New state
 */
export function setShowSecrets(value: boolean) {
  setShowSecretsSignal(value);
}

/**
 * Recorded entries, oldest first (reactive). Secrets are redacted unless
 * `showSecrets` is true. The browser's resource entries for fetch and
 * XMLHttpRequest are merged into the matching http entries (`mergeResources`),
 * so a request appears once.
 *
 * @param options.showSecrets Return the raw stored values
 */
export function entries(options?: { showSecrets?: boolean }): TrafficEntry[] {
  version();
  const secrets = !!options?.showSecrets;
  // every consumer asks for the same list: build it once per change
  if (
    cached &&
    cached.generation === generation &&
    cached.secrets === secrets
  ) {
    return cached.result;
  }
  const all = recorder.snapshot();
  const result = mergeResources(
    secrets ? all : all.map((entry) => redactedOf(entry)),
  );
  cached = { generation, secrets, result };
  return result;
}

/**
 * Remove all recorded entries.
 */
export function clear() {
  recorder.clear();
  setVersion((v) => v + 1);
}

/**
 * Record a call's connection details, byte counts, data messages and
 * participant attributes while recording is on (see `monitorCall`). Call once
 * per room, before connecting. Costs nothing while recording is off.
 *
 * @param room The LiveKit room
 * @param options.url SFU address the room is joined with
 * @param options.e2ee Whether the call's media is end-to-end encrypted
 * @returns A function that stops watching the call
 */
export function watchCallTraffic(
  room: CallRoomLike,
  options: { url: string; e2ee: () => boolean },
): () => void {
  try {
    return monitorCall(room, recorder, options);
  } catch {
    return () => {};
  }
}
