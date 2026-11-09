import { describe, expect, it } from "vitest";

import { TrafficRecorder } from "./recorder";
import { wrapWebSocket } from "./wsWrapper";
import { wrapXhr } from "./xhrWrapper";

/** Minimal WebSocket stand-in with the parts the wrapper touches. */
class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  binaryType = "blob";
  url: string;
  sent: unknown[] = [];
  failSend = false;

  /** @param url Address */
  constructor(url: string) {
    super();
    this.url = url;
  }

  /** Store the frame, or throw like a closed socket. */
  send(data: unknown) {
    if (this.failSend) throw new Error("InvalidStateError");
    this.sent.push(data);
  }
}

describe("wrapWebSocket", () => {
  const make = (enabled: boolean) => {
    const recorder = new TrafficRecorder();
    recorder.enabled = enabled;
    const Wrapped = wrapWebSocket(
      FakeSocket as unknown as typeof WebSocket,
      recorder,
    );
    return { recorder, Wrapped };
  };

  it("keeps instanceof and statics", () => {
    const { Wrapped } = make(false);
    const socket = new Wrapped("wss://a.example/");
    expect(socket instanceof (FakeSocket as unknown as typeof WebSocket)).toBe(
      true,
    );
    expect(Wrapped.OPEN).toBe(1);
    expect(Wrapped.name).toBe("WebSocket");
  });

  it("uses one URL for all entries of a connection", () => {
    const { recorder, Wrapped } = make(true);
    const socket = new Wrapped("wss://a.example/x");
    socket.send("hi");
    socket.dispatchEvent(new Event("open"));
    const urls = new Set(
      recorder.snapshot().map((e) => (e as { url: string }).url),
    );
    expect(urls.size).toBe(1);
  });

  it("records frames only while on", () => {
    const { recorder, Wrapped } = make(false);
    const socket = new Wrapped("wss://a.example/?token=x");
    socket.send("quiet");
    expect(recorder.snapshot()).toEqual([]);
    recorder.enabled = true;
    socket.send("hello");
    socket.dispatchEvent(new MessageEvent("message", { data: "back" }));
    const events = recorder
      .snapshot()
      .map((e) => (e as { event: string }).event);
    expect(events).toEqual(["attached", "frame", "frame"]);
  });

  it("rethrows send errors and does not record the frame", () => {
    const { recorder, Wrapped } = make(true);
    const socket = new Wrapped("wss://a.example/");
    (socket as unknown as FakeSocket).failSend = true;
    expect(() => socket.send("x")).toThrow("InvalidStateError");
    expect(
      recorder
        .snapshot()
        .filter((e) => (e as { event: string }).event === "frame"),
    ).toEqual([]);
  });
});

describe("wrapXhr", () => {
  it("forgets stale state when re-opened while off", () => {
    const listeners: (() => void)[] = [];
    class FakeXhr {
      status = 200;
      statusText = "OK";
      responseType = "";
      responseText = "";
      /** Original open. */
      open(_method: string, _url: string) {}
      /** Original setRequestHeader. */
      setRequestHeader() {}
      /** Original send. */
      send() {}
      /** Remember the loadend listener. */
      addEventListener(_: string, fn: () => void) {
        listeners.push(fn);
      }
      /** No headers. */
      getAllResponseHeaders() {
        return "";
      }
    }
    const recorder = new TrafficRecorder();
    recorder.enabled = true;
    wrapXhr(FakeXhr as unknown as typeof XMLHttpRequest, recorder);
    const xhr = new FakeXhr();
    xhr.open("GET", "https://a.example/old");
    recorder.enabled = false;
    xhr.open("GET", "https://a.example/new");
    recorder.enabled = true;
    xhr.send();
    expect(listeners).toHaveLength(0);
  });
});
