import { describe, expect, it } from "vitest";

import {
  REDACTED,
  isSecretRoute,
  redactEntry,
  redactHeaders,
  redactJsonText,
  redactUrl,
} from "./redact";
import type { HttpEntry, TrafficEntry, WsEntry } from "./types";

describe("redactHeaders", () => {
  it("hides secret headers only", () => {
    expect(
      redactHeaders([
        ["X-Session-Token", "abc"],
        ["authorization", "Bearer x"],
        ["Cookie", "a=b"],
        ["Set-Cookie", "a=b"],
        ["X-MFA-Ticket", "tick"],
        ["Accept", "*/*"],
      ]),
    ).toEqual([
      ["X-Session-Token", REDACTED],
      ["authorization", REDACTED],
      ["Cookie", REDACTED],
      ["Set-Cookie", REDACTED],
      ["X-MFA-Ticket", REDACTED],
      ["Accept", "*/*"],
    ]);
  });
});

describe("redactUrl", () => {
  it("hides token query params", () => {
    const out = redactUrl("wss://x.example/rtc?access_token=abc&keep=1");
    expect(out).toContain("access_token=[redacted]");
    expect(out).toContain("keep=1");
    expect(out).not.toContain("abc");
    expect(redactUrl("wss://x.example/?token=zzz")).not.toContain("zzz");
  });

  it("hides session and bot tokens passed as params", () => {
    const out = redactUrl(
      "https://x.example/?x-session-token=aaa&x-bot-token=bbb",
    );
    expect(out).not.toContain("aaa");
    expect(out).not.toContain("bbb");
  });

  it("hides verification codes in paths", () => {
    expect(
      redactUrl("https://x.example/auth/account/verify/SECRET1"),
    ).not.toContain("SECRET1");
  });

  it("keeps other params byte-identical", () => {
    expect(redactUrl("https://x.example/p?a=b%20c&token=zz&d=e+f")).toBe(
      `https://x.example/p?a=b%20c&token=${REDACTED}&d=e+f`,
    );
  });

  it("hides params in the fragment and credentials", () => {
    const out = redactUrl("https://user:pw@x.example/p#access_token=abc&k=1");
    expect(out).toBe(`https://x.example/p#access_token=${REDACTED}&k=1`);
  });

  it("copes with unparseable urls", () => {
    expect(redactUrl("/x?token=abc&a=1")).toBe(`/x?token=${REDACTED}&a=1`);
  });
});

describe("redactJsonText", () => {
  it("hides secret fields at any depth", () => {
    const out = JSON.parse(
      redactJsonText(
        JSON.stringify({
          name: "a",
          password: "p",
          nested: [{ totp_code: "123", ok: 1 }],
          authentication: { mfa_ticket: "t", recovery_code: "r" },
          session_token: "s",
        }),
      ),
    );
    expect(out).toEqual({
      name: "a",
      password: REDACTED,
      nested: [{ totp_code: REDACTED, ok: 1 }],
      authentication: { mfa_ticket: REDACTED, recovery_code: REDACTED },
      session_token: REDACTED,
    });
  });

  it("falls back to a pattern for cut-off JSON", () => {
    const out = redactJsonText('{"a":1,"password":"hunter2","b":"long te');
    expect(out).not.toContain("hunter2");
    expect(out).toContain('"a":1');
  });

  it("hides secrets in form-encoded text", () => {
    const out = redactJsonText("a=1&password=hunter2&totp%5Fcode=123&token=x");
    expect(out).toBe(
      `a=1&password=${REDACTED}&totp%5Fcode=${REDACTED}&token=${REDACTED}`,
    );
  });

  it("keeps a __proto__ key", () => {
    const out = redactJsonText('{"__proto__":{"a":1},"password":"p"}');
    expect(out).toContain("__proto__");
    expect(out).not.toContain('"p"');
  });

  it("leaves other text alone", () => {
    expect(redactJsonText("hello")).toBe("hello");
  });
});

describe("redactEntry", () => {
  const base: HttpEntry = {
    kind: "http",
    id: 1,
    source: "fetch",
    method: "POST",
    url: "https://api.example/auth/session/login",
    host: "api.example",
    start: 0,
    end: 1,
    requestHeaders: [["X-Session-Token", "t"]],
    responseHeaders: [],
    requestBody: {
      kind: "text",
      size: 10,
      text: '{"password":"p"}',
      truncated: false,
    },
    responsePreview: '{"token":"abc"}',
  };

  it("hides whole bodies of auth routes", () => {
    const out = redactEntry(base);
    expect(out.requestBody).toMatchObject({ text: REDACTED });
    expect(out.responsePreview).toBe(REDACTED);
    expect(out.requestHeaders[0][1]).toBe(REDACTED);
    // the stored entry is untouched
    expect(base.responsePreview).toBe('{"token":"abc"}');
  });

  it("hides fields in other routes", () => {
    const out = redactEntry({
      ...base,
      url: "https://api.example/users/@me",
      responsePreview: '{"token":"abc","name":"n"}',
    });
    expect(JSON.parse(out.responsePreview!)).toEqual({
      token: REDACTED,
      name: "n",
    });
  });

  it("redacts websocket frames and urls", () => {
    const ws: WsEntry = {
      kind: "ws",
      id: 2,
      connectionId: 1,
      event: "frame",
      url: "wss://events.example/?token=abc",
      host: "events.example",
      time: 0,
      text: '{"type":"Authenticate","token":"abc"}',
    };
    const out = redactEntry(ws);
    expect(out.url).not.toContain("abc");
    expect(out.text).not.toContain("abc");
    expect(out.text).toContain("Authenticate");
  });

  it("knows secret routes", () => {
    expect(isSecretRoute("https://a/auth/mfa/ticket")).toBe(true);
    expect(isSecretRoute("https://a/auth/account/change/password")).toBe(true);
    expect(isSecretRoute("https://a/push/subscribe")).toBe(true);
    expect(isSecretRoute("https://a/users/@me")).toBe(false);
  });
});

describe("redaction of free text fields", () => {
  it("redacts secrets in a websocket close reason", () => {
    const e = redactEntry({
      kind: "ws",
      id: 1,
      connectionId: 1,
      event: "close",
      url: "wss://x.example.com/",
      host: "x.example.com",
      time: 0,
      reason: '{"token":"SECRET","why":"bye"}',
    } as TrafficEntry) as { reason: string };
    expect(e.reason).not.toContain("SECRET");
    expect(e.reason).toContain("bye");
  });

  it("redacts secrets in a request error and keeps plain errors", () => {
    const base = {
      kind: "http",
      id: 1,
      source: "fetch",
      method: "GET",
      url: "https://x.example.com/",
      host: "x.example.com",
      start: 0,
      end: 1,
      requestHeaders: [],
      responseHeaders: [],
      requestBody: { kind: "none" },
    };
    const secret = redactEntry({
      ...base,
      error: 'bad {"access_token":"SECRET"}',
    } as TrafficEntry) as { error: string };
    expect(secret.error).not.toContain("SECRET");
    const plain = redactEntry({
      ...base,
      error: "Failed to fetch",
    } as TrafficEntry) as { error: string };
    expect(plain.error).toBe("Failed to fetch");
    expect(
      (redactEntry(base as TrafficEntry) as { error?: string }).error,
    ).toBeUndefined();
  });
});
