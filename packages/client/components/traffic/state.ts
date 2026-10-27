import { createSignal } from "solid-js";

import { type CallRoomLike, monitorCall } from "./callTraffic";
import { installWrappers } from "./install";
import { TrafficRecorder } from "./recorder";
import { redactEntry } from "./redact";
import { observeResources } from "./resources";
import type { TrafficEntry } from "./types";

/** The one recorder shared by the whole app. */
const recorder = new TrafficRecorder();

/** Whether recording is on, for reactive readers. */
const [recordingSignal, setRecordingSignal] = createSignal(false);
/** Bumped when entries change, so `entries()` re-runs. */
const [version, setVersion] = createSignal(0);

/** Stops the resource observer while recording is on. */
let stopResources: (() => void) | undefined;

/** Pending flush of change notifications, so busy sockets don't thrash the UI. */
let flushTimer: ReturnType<typeof setTimeout> | undefined;

recorder.subscribe(() => {
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
 * Turn recording on or off. Turning it on also starts the resource observer.
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
  } else {
    stopResources?.();
    stopResources = undefined;
  }
}

/**
 * Recorded entries, oldest first (reactive). Secrets are redacted unless
 * `showSecrets` is true.
 *
 * @param options.showSecrets Return the raw stored values
 */
export function entries(options?: { showSecrets?: boolean }): TrafficEntry[] {
  version();
  const all = recorder.snapshot();
  return options?.showSecrets ? all : all.map((entry) => redactEntry(entry));
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
