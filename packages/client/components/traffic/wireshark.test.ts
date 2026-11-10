import { describe, expect, it } from "vitest";

import type { CallConnectionEntry } from "./types";
import type { Destination } from "./view";
import {
  callFilter,
  callTransport,
  destinationFilter,
  hostFilter,
  ipFilter,
  quoteFilterString,
  splitHostPort,
} from "./wireshark";

const connection = (
  extra: Partial<CallConnectionEntry>,
): CallConnectionEntry => ({
  kind: "call-connection",
  id: 1,
  time: 0,
  pc: "publisher",
  relayed: false,
  ...extra,
});

describe("quoteFilterString", () => {
  it("escapes quotes and backslashes", () => {
    expect(quoteFilterString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("escapes control characters", () => {
    expect(quoteFilterString("a\nb\u0001")).toBe('"a\\nb\\x01"');
  });
});

describe("splitHostPort", () => {
  it("splits names, IPv4 and bracketed IPv6", () => {
    expect(splitHostPort("a.test")).toEqual({ host: "a.test" });
    expect(splitHostPort("a.test:8443")).toEqual({
      host: "a.test",
      port: 8443,
    });
    expect(splitHostPort("1.2.3.4:7881")).toEqual({
      host: "1.2.3.4",
      port: 7881,
    });
    expect(splitHostPort("[2001:db8::1]:7881")).toEqual({
      host: "2001:db8::1",
      port: 7881,
    });
    expect(splitHostPort("[::1]")).toEqual({ host: "::1" });
  });

  it("keeps a bare IPv6 address whole", () => {
    expect(splitHostPort("2001:db8::1")).toEqual({ host: "2001:db8::1" });
  });
});

describe("hostFilter", () => {
  it("uses the TLS server name for secure hosts and drops the port", () => {
    expect(hostFilter("api.test:8443", true)).toBe(
      'tls.handshake.extensions_server_name == "api.test"',
    );
  });

  it("uses the HTTP host for plain connections", () => {
    expect(hostFilter("api.test", false)).toBe('http.host == "api.test"');
  });

  it("escapes quotes in host names", () => {
    expect(hostFilter('ev"il.test', true)).toBe(
      'tls.handshake.extensions_server_name == "ev\\"il.test"',
    );
  });

  it("matches IP hosts by address", () => {
    expect(hostFilter("192.168.1.2:5173", false)).toBe(
      "ip.addr == 192.168.1.2 && (tcp.port == 5173 || udp.port == 5173)",
    );
    expect(hostFilter("[::1]:5173", true)).toBe(
      "ipv6.addr == ::1 && (tcp.port == 5173 || udp.port == 5173)",
    );
  });
});

describe("ipFilter", () => {
  it("uses ipv6.addr for IPv6", () => {
    expect(ipFilter("2001:db8::1", 7881, "udp")).toBe(
      "ipv6.addr == 2001:db8::1 && udp.port == 7881",
    );
  });

  it("leaves the port out when unknown", () => {
    expect(ipFilter("203.0.113.5", undefined, "udp")).toBe(
      "ip.addr == 203.0.113.5",
    );
  });
});

describe("callFilter", () => {
  it("builds a UDP filter from the selected path", () => {
    expect(
      callFilter(
        connection({
          remoteAddress: "203.0.113.5",
          remotePort: 7882,
          protocol: "udp",
        }),
      ),
    ).toBe("ip.addr == 203.0.113.5 && udp.port == 7882");
  });

  it("uses TCP for TCP paths and TCP or TLS relays", () => {
    expect(callTransport(connection({ protocol: "tcp" }))).toBe("tcp");
    expect(
      callTransport(
        connection({ protocol: "udp", relayed: true, relayProtocol: "tls" }),
      ),
    ).toBe("tcp");
    expect(
      callTransport(
        connection({ protocol: "tcp", relayed: true, relayProtocol: "udp" }),
      ),
    ).toBe("udp");
    expect(callTransport(connection({}))).toBe("udp");
  });

  it("handles IPv6 remotes", () => {
    expect(
      callFilter(
        connection({ remoteAddress: "2001:db8::7", remotePort: 3478 }),
      ),
    ).toBe("ipv6.addr == 2001:db8::7 && udp.port == 3478");
  });

  it("gives nothing without a remote address", () => {
    expect(callFilter(connection({}))).toBeUndefined();
  });
});

describe("destinationFilter", () => {
  const row = (extra: Partial<Destination>): Destination => ({
    host: "a.test",
    type: "https",
    service: "api",
    count: 1,
    ...extra,
  });

  it("uses the server name for https, wss and files", () => {
    for (const type of ["https", "wss", "files", "call"] as const) {
      expect(destinationFilter(row({ type }))).toBe(
        'tls.handshake.extensions_server_name == "a.test"',
      );
    }
  });

  it("uses the Host header for http and ws", () => {
    expect(destinationFilter(row({ type: "ws" }))).toBe(
      'http.host == "a.test"',
    );
  });

  it("uses the address for call media", () => {
    expect(
      destinationFilter(
        row({
          type: "call",
          host: "1.2.3.4:7881",
          remote: { address: "1.2.3.4", port: 7881, transport: "tcp" },
        }),
      ),
    ).toBe("ip.addr == 1.2.3.4 && tcp.port == 7881");
  });
});

describe("zones, host names and plain files", () => {
  it("strips IPv6 zone ids", () => {
    expect(splitHostPort("[fe80::1%eth0]:7881")).toEqual({
      host: "fe80::1",
      port: 7881,
    });
    expect(ipFilter("fe80::1%eth0", 1, "udp")).toBe(
      "ipv6.addr == fe80::1 && udp.port == 1",
    );
    expect(
      callFilter(connection({ remoteAddress: "fe80::1%eth0", remotePort: 5 })),
    ).toBe("ipv6.addr == fe80::1 && udp.port == 5");
  });

  it("gives no filter for a host name remote", () => {
    expect(
      callFilter(connection({ remoteAddress: "x.local", remotePort: 5 })),
    ).toBeUndefined();
    expect(
      destinationFilter({
        host: "x.local:5",
        type: "call",
        service: "call-media",
        count: 1,
      }),
    ).toBeUndefined();
  });

  it("uses the Host header for files loaded over http", () => {
    expect(
      destinationFilter({
        host: "cdn.test",
        type: "files",
        service: "other",
        secure: false,
        count: 1,
      }),
    ).toBe('http.host == "cdn.test"');
  });
});
