import type { TrafficRecorder } from "./recorder";
import {
  FRAME_PREVIEW_LIMIT,
  HEX_BYTES,
  hexPreview,
  hostOf,
  truncateText,
  utf8Length,
} from "./summarize";

/** Data accepted by `WebSocket.send`. */
type SendData = Parameters<WebSocket["send"]>[0];

/**
 * Subclass `WebSocket` so connections and frames are recorded. The subclass
 * keeps `instanceof`, the static constants, `binaryType` and event order. Its
 * listeners and `send` check `recorder.enabled` first, so with recording off
 * they do nothing, and sockets opened before recording was turned on still
 * show up (as `attached`) once they carry a frame.
 *
 * @param Original The `WebSocket` class to wrap
 * @param recorder Where entries go
 * @param now Clock, replaceable in tests
 */
export function wrapWebSocket(
  Original: typeof WebSocket,
  recorder: TrafficRecorder,
  now: () => number = Date.now,
): typeof WebSocket {
  /** Recording WebSocket. */
  class RecordingWebSocket extends Original {
    #connectionId = recorder.newConnectionId();
    #announced = false;

    /**
     * @param url Address to connect to
     * @param protocols Optional sub-protocol(s)
     */
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      // always the absolute URL, the same one `send` records
      const href = this.url || String(url);
      const host = hostOf(href);

      /** Emit the connection entry once, before the first thing recorded. */
      const announce = (event: "connect" | "attached") => {
        if (this.#announced) return;
        this.#announced = true;
        recorder.record({
          kind: "ws",
          connectionId: this.#connectionId,
          event,
          url: href,
          host,
          time: now(),
        });
      };

      if (recorder.enabled) {
        try {
          announce("connect");
        } catch {
          // recording must not matter
        }
      }

      this.addEventListener("open", () => {
        if (!recorder.enabled) return;
        try {
          announce("attached");
          recorder.record({
            kind: "ws",
            connectionId: this.#connectionId,
            event: "open",
            url: href,
            host,
            time: now(),
          });
        } catch {
          // recording must not matter
        }
      });

      this.addEventListener("error", () => {
        if (!recorder.enabled) return;
        try {
          announce("attached");
          recorder.record({
            kind: "ws",
            connectionId: this.#connectionId,
            event: "error",
            url: href,
            host,
            time: now(),
          });
        } catch {
          // recording must not matter
        }
      });

      this.addEventListener("close", (event) => {
        if (!recorder.enabled) return;
        try {
          announce("attached");
          const close = event as CloseEvent;
          recorder.record({
            kind: "ws",
            connectionId: this.#connectionId,
            event: "close",
            url: href,
            host,
            time: now(),
            code: close.code,
            reason: close.reason,
            wasClean: close.wasClean,
          });
        } catch {
          // recording must not matter
        }
      });

      this.addEventListener("message", (event) => {
        if (!recorder.enabled) return;
        try {
          announce("attached");
          this.#recordFrame("in", (event as MessageEvent).data, href, host);
        } catch {
          // recording must not matter
        }
      });
    }

    /** Record outgoing frames, then send exactly as the original. */
    send(data: SendData) {
      // send first: a throwing send (socket not open) is not a sent frame
      const result = super.send(data);
      if (recorder.enabled) {
        try {
          this.#recordFrame("out", data, this.url, hostOf(this.url), true);
        } catch {
          // recording must not matter
        }
      }
      return result;
    }

    /** Store one frame entry. */
    #recordFrame(
      direction: "in" | "out",
      data: unknown,
      url: string,
      host: string,
      announceFirst = false,
    ) {
      if (announceFirst && !this.#announced) {
        this.#announced = true;
        recorder.record({
          kind: "ws",
          connectionId: this.#connectionId,
          event: "attached",
          url,
          host,
          time: now(),
        });
      }
      const base = {
        kind: "ws" as const,
        connectionId: this.#connectionId,
        event: "frame" as const,
        url,
        host,
        time: now(),
        direction,
      };
      if (typeof data === "string") {
        recorder.record({
          ...base,
          size: utf8Length(data),
          ...truncateText(data, FRAME_PREVIEW_LIMIT),
        });
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        const { hex, truncated, size } = hexPreview(data, HEX_BYTES);
        recorder.record({ ...base, size, hex, truncated });
      } else if (typeof Blob !== "undefined" && data instanceof Blob) {
        recorder.record({ ...base, size: data.size });
      } else {
        recorder.record(base);
      }
    }
  }

  Object.defineProperty(RecordingWebSocket, "name", { value: "WebSocket" });
  return RecordingWebSocket;
}
