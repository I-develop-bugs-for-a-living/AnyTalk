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

describe("redactAddresses", () => {
  it("hides the address and port of host, srflx and relay candidates", async () => {
    const { redactAddresses } = await import("./redact");
    const out = redactAddresses(
      "candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0 ufrag abcd",
    );
    expect(out).not.toContain("192.168.1.20");
    expect(out).not.toContain("54321");
    expect(out).toContain("typ host generation 0 ufrag abcd");
    expect(out).toContain("candidate:1 1 udp 2122260223");
  });

  it("hides the related address of reflexive candidates", async () => {
    const { redactAddresses } = await import("./redact");
    const out = redactAddresses(
      "candidate:2 1 udp 1686052607 203.0.113.9 40000 typ srflx raddr 192.168.1.20 rport 40000 generation 0",
    );
    expect(out).not.toMatch(/203\.0\.113\.9|192\.168\.1\.20|40000/);
    expect(out).toContain("typ srflx raddr");
    expect(out).toContain("generation 0");
  });

  it("handles IPv6 and mDNS candidates", async () => {
    const { redactAddresses } = await import("./redact");
    const v6 = redactAddresses(
      "candidate:3 1 udp 100 2001:db8::1234 50000 typ host",
    );
    expect(v6).not.toContain("2001:db8");
    const mdns = redactAddresses(
      "candidate:4 1 udp 100 3f2b1c9e-1111-2222-3333-444455556666.local 50001 typ host",
    );
    expect(mdns).not.toContain(".local");
    expect(mdns).not.toContain("50001");
  });

  it("hides c= and o= lines, also inside JSON text", async () => {
    const { redactAddresses } = await import("./redact");
    const out = redactAddresses(
      '{"sdp":"v=0\\r\\no=- 123 2 IN IP4 127.0.0.1\\r\\nc=IN IP4 203.0.113.9\\r\\na=rtcp:9 IN IP6 2001:db8::1\\r\\n"}',
    );
    expect(out).not.toMatch(/127\.0\.0\.1|203\.0\.113\.9|2001:db8/);
    expect(out).toContain("\\r\\n");
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("leaves other text alone", async () => {
    const { redactAddresses } = await import("./redact");
    expect(redactAddresses("ping 1.2.3.4 done")).toBe("ping 1.2.3.4 done");
  });
});

describe("redactEntry hides own addresses in signalling frames", () => {
  it("masks ws frames and leaves call connections visible", async () => {
    const { redactEntry } = await import("./redact");
    const frame = redactEntry({
      kind: "ws",
      id: 1,
      connectionId: 1,
      event: "frame",
      url: "wss://lk.test/rtc",
      host: "lk.test",
      time: 0,
      text: '{"candidate":"candidate:1 1 udp 1 10.0.0.5 5000 typ host"}',
    });
    expect(frame.text).not.toContain("10.0.0.5");
    const conn = {
      kind: "call-connection" as const,
      id: 2,
      time: 0,
      pc: "publisher" as const,
      relayed: false,
      remoteAddress: "203.0.113.5",
      remotePort: 7882,
    };
    expect(redactEntry(conn)).toBe(conn);
  });
});

describe("redactAddresses on cut off previews", () => {
  const leaks = (text: string) =>
    /\d+\.\d+\.\d+\.\d+|2001:db8|[0-9a-f-]{20,}\.local/i.test(text);
  const full =
    "candidate:2 1 udp 1686052607 203.0.113.9 40000 typ srflx raddr 192.168.1.20 rport 40001 generation 0";

  it("hides the address wherever the text is cut", async () => {
    const { redactAddresses } = await import("./redact");
    const start = full.indexOf("203");
    for (let cut = start + 1; cut <= full.length; cut++) {
      const out = redactAddresses(full.slice(0, cut));
      // a cut inside the first octet leaves at most digits of one octet
      expect(out, full.slice(0, cut)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      expect(out, full.slice(0, cut)).not.toContain("203.0");
      if (cut > full.indexOf("192")) expect(out).not.toContain("192.168");
    }
  });

  it("hides raddr without rport and a cut in the middle of rport", async () => {
    const { redactAddresses } = await import("./redact");
    expect(redactAddresses("typ srflx raddr 192.168.1.20")).not.toContain(
      "192.168",
    );
    expect(
      redactAddresses("typ srflx raddr 192.168.1.20 rport 400"),
    ).not.toContain("400");
  });

  it("hides cut off IPv6 and mDNS addresses", async () => {
    const { redactAddresses } = await import("./redact");
    expect(leaks(redactAddresses("candidate:3 1 udp 100 2001:db8:1"))).toBe(
      false,
    );
    expect(
      leaks(
        redactAddresses(
          "candidate:4 1 udp 100 3f2b1c9e-1111-2222-3333-444455556666.lo",
        ),
      ),
    ).toBe(false);
  });
});

describe("redactAddresses structured fields", () => {
  it("hides address-like JSON values", async () => {
    const { redactAddresses } = await import("./redact");
    const out = redactAddresses(
      '{"address":"192.168.1.5","relatedAddress":"10.0.0.2","relayAddress":"2001:db8::7","ip":"abcd-1234.local","ipAddress":"198.51.100.4","port":5000}',
    );
    expect(out).not.toMatch(/192\.168|10\.0\.0|2001:db8|abcd-1234|198\.51/);
    expect(out).toContain('"port":5000');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("keeps non-address values and cut off ones are hidden", async () => {
    const { redactAddresses } = await import("./redact");
    expect(redactAddresses('{"ip":"not an ip","address":"Main St 4"}')).toBe(
      '{"ip":"not an ip","address":"Main St 4"}',
    );
    expect(redactAddresses('{"address":"192.168.')).not.toContain("192.168");
  });

  it("hides remote-candidates lines", async () => {
    const { redactAddresses } = await import("./redact");
    const out = redactAddresses(
      "a=remote-candidates:1 192.168.1.5 5000 2 192.168.1.5 5001\r\na=end",
    );
    expect(out).not.toContain("192.168");
    expect(out).toContain("a=end");
  });
});
