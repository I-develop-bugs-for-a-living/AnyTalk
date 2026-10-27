import { describe, expect, it, vi } from "vitest";

import { wrapFetch } from "./fetchWrapper";
import { installWrappers } from "./install";
import { TrafficRecorder } from "./recorder";
import { redactEntry } from "./redact";
import type { HttpEntry } from "./types";

/** Let pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("wrapFetch", () => {
  it("passes through without recording while off", async () => {
    const response = new Response("hi");
    const original = vi.fn().mockResolvedValue(response);
    const recorder = new TrafficRecorder();
    const wrapped = wrapFetch(original, recorder);
    const result = await wrapped("https://a.example/x");
    await flush();
    expect(result).toBe(response);
    expect(original).toHaveBeenCalledWith("https://a.example/x");
    expect(recorder.snapshot()).toEqual([]);
  });

  it("records and redacts when on", async () => {
    const original = vi.fn().mockImplementation(
      async () =>
        new Response('{"token":"abc","name":"n"}', {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "26",
          },
        }),
    );
    const recorder = new TrafficRecorder();
    recorder.enabled = true;
    const wrapped = wrapFetch(original, recorder);
    const response = await wrapped("https://api.example/users/@me", {
      method: "post",
      headers: { "X-Session-Token": "secret", Accept: "application/json" },
      body: JSON.stringify({ password: "hunter2" }),
    });
    await flush();

    // the caller can still read the body
    expect(await response.json()).toEqual({ token: "abc", name: "n" });

    const [raw] = recorder.snapshot() as HttpEntry[];
    expect(raw).toMatchObject({
      kind: "http",
      source: "fetch",
      method: "POST",
      host: "api.example",
      status: 200,
    });
    expect(raw.requestHeaders).toContainEqual(["X-Session-Token", "secret"]);

    const shown = redactEntry(raw);
    expect(JSON.stringify(shown)).not.toContain("secret");
    expect(JSON.stringify(shown)).not.toContain("hunter2");
    expect(JSON.stringify(shown)).not.toContain("abc");
    expect(shown.responsePreview).toContain("name");
  });

  it("rethrows the original error and records the failure", async () => {
    const failure = new TypeError("Failed to fetch");
    const original = vi.fn().mockRejectedValue(failure);
    const recorder = new TrafficRecorder();
    recorder.enabled = true;
    const wrapped = wrapFetch(original, recorder);
    await expect(wrapped("https://a.example/")).rejects.toBe(failure);
    await flush();
    expect(recorder.snapshot()[0]).toMatchObject({
      kind: "http",
      error: "TypeError",
    });
  });

  it("keeps a rejected fetch unhandled for the caller", async () => {
    const failure = new TypeError("nope");
    const recorder = new TrafficRecorder();
    recorder.enabled = true;
    const wrapped = wrapFetch(vi.fn().mockRejectedValue(failure), recorder);
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    void wrapped("https://a.example/"); // fire and forget
    await flush();
    await flush();
    process.off("unhandledRejection", onUnhandled);
    expect(seen).toEqual([failure]);
  });

  it("merges Request and init headers, init winning", async () => {
    const recorder = new TrafficRecorder();
    recorder.enabled = true;
    const original = vi.fn().mockResolvedValue(new Response("x"));
    const request = new Request("https://a.example/", {
      headers: { a: "1", b: "2" },
    });
    await wrapFetch(original, recorder)(request, { headers: { B: "3" } });
    const [entry] = recorder.snapshot() as HttpEntry[];
    expect(entry.requestHeaders).toEqual([
      ["a", "1"],
      ["B", "3"],
    ]);
  });

  it("rethrows synchronous errors", () => {
    const failure = new Error("boom");
    const original = vi.fn().mockImplementation(() => {
      throw failure;
    });
    const recorder = new TrafficRecorder();
    recorder.enabled = true;
    expect(() => wrapFetch(original, recorder)("x")).toThrow(failure);
  });

  it("doesn't read bodies of unknown length", async () => {
    const response = new Response("streamed");
    const clone = vi.spyOn(response, "clone");
    const original = vi.fn().mockResolvedValue(response);
    const recorder = new TrafficRecorder();
    recorder.enabled = true;
    await wrapFetch(original, recorder)("https://a.example/");
    await flush();
    expect(clone).not.toHaveBeenCalled();
    expect(recorder.snapshot()).toHaveLength(1);
  });
});

describe("installWrappers", () => {
  it("is idempotent", () => {
    const target = {
      fetch: vi.fn(),
    } as unknown as typeof globalThis;
    const recorder = new TrafficRecorder();
    expect(installWrappers(recorder, target)).toBe(true);
    const first = target.fetch;
    expect(installWrappers(recorder, target)).toBe(false);
    expect(target.fetch).toBe(first);
  });
});
