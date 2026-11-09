import type { CallConnectionEntry } from "./types";
import type { Destination } from "./view";

/** Transport of an IP filter: one of the two, or either (unknown). */
type FilterTransport = CallTransport | "any";

/** Transport a call path uses on the wire. */
export type CallTransport = "udp" | "tcp";

/** Where a call connection goes, as the filter needs it. */
export type CallRemote = {
  address: string;
  port?: number;
  transport: CallTransport;
};

/**
 * Quote a value as a Wireshark display filter string: backslashes and double
 * quotes are escaped, control characters are written as escapes.
 *
 * @param value Text to quote
 */
export function quoteFilterString(value: string): string {
  // eslint-disable-next-line no-control-regex
  const escaped = value.replace(/[\\"\u0000-\u001f\u007f]/g, (c) => {
    switch (c) {
      case "\\":
        return "\\\\";
      case '"':
        return '\\"';
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default:
        return `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
    }
  });
  return `"${escaped}"`;
}

/** Whether a string is an IPv4 address in dotted form. */
function isIpv4(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

/** Remove an IPv6 zone id ("fe80::1%eth0" becomes "fe80::1"). */
function stripZone(address: string): string {
  return address.replace(/%.*$/, "");
}

/** Whether a string is an IPv4 or IPv6 address (not a host name). */
function isIp(value: string): boolean {
  return isIpv4(value) || (value.includes(":") && /^[0-9a-f:.]+$/i.test(value));
}

/**
 * Split "host", "host:port", "1.2.3.4:5" or "[::1]:5" into address and port.
 * A bare IPv6 address (several colons, no brackets) has no port.
 *
 * @param value Host as shown in the inspector
 */
export function splitHostPort(value: string): { host: string; port?: number } {
  const text = value.trim();
  const bracket = /^\[([^\]]*)\](?::(\d+))?$/.exec(text);
  if (bracket) {
    return {
      host: stripZone(bracket[1]),
      ...(bracket[2] ? { port: Number(bracket[2]) } : {}),
    };
  }
  const colons = text.split(":").length - 1;
  if (colons > 1) return { host: stripZone(text) };
  if (colons === 1) {
    const [host, port] = text.split(":");
    return /^\d+$/.test(port) ? { host, port: Number(port) } : { host: text };
  }
  return { host: text };
}

/**
 * Filter for traffic to or from one IP address and, when known, one port.
 * IPv6 addresses use `ipv6.addr`, as `ip.addr` only matches IPv4.
 *
 * @param address IPv4 or IPv6 address, without brackets
 * @param port Port, when known
 * @param transport Decides between `udp.port` and `tcp.port`, or both
 */
export function ipFilter(
  address: string,
  port: number | undefined,
  transport: FilterTransport,
): string {
  const field = address.includes(":") ? "ipv6.addr" : "ip.addr";
  const base = `${field} == ${stripZone(address)}`;
  if (port === undefined) return base;
  return transport === "any"
    ? `${base} && (tcp.port == ${port} || udp.port == ${port})`
    : `${base} && ${transport}.port == ${port}`;
}

/**
 * Display filter for a host name. TLS connections carry the name in the
 * handshake (SNI); plain HTTP carries it in the Host header. Hosts that are
 * IP addresses have neither, so they are matched by address (and port).
 *
 * @param host Host with an optional port, as in a URL
 * @param secure Whether the connection uses TLS
 */
export function hostFilter(host: string, secure: boolean): string {
  const { host: name, port } = splitHostPort(host);
  if (isIp(name)) {
    return ipFilter(name, port, "any");
  }
  return secure
    ? `tls.handshake.extensions_server_name == ${quoteFilterString(name)}`
    : `http.host == ${quoteFilterString(name)}`;
}

/**
 * The transport the packets of a call connection travel over. Through a TURN
 * relay it is the protocol spoken to the relay (tcp and tls are TCP), else
 * the transport of the selected candidate pair. UDP when nothing is known.
 *
 * @param entry A call connection entry
 */
export function callTransport(entry: CallConnectionEntry): CallTransport {
  const protocol = (entry.relayed && entry.relayProtocol) || entry.protocol;
  return protocol && /^(tcp|tls)$/i.test(protocol) ? "tcp" : "udp";
}

/**
 * Where a call connection goes, or nothing when its address is unknown.
 *
 * @param entry A call connection entry
 */
export function callRemote(entry: CallConnectionEntry): CallRemote | undefined {
  // a mDNS or other host name can't be matched on the wire by address
  if (!entry.remoteAddress || !isIp(stripZone(entry.remoteAddress))) {
    return undefined;
  }
  return {
    address: stripZone(entry.remoteAddress),
    port: entry.remotePort,
    transport: callTransport(entry),
  };
}

/**
 * Display filter for a call connection with a known remote address, or
 * nothing when the address is unknown. The remote is the peer the selected
 * candidate pair points at; with a TURN relay Wireshark may instead show the
 * relay server's address (see the relay server field of the entry).
 *
 * @param entry A call connection entry
 */
export function callFilter(entry: CallConnectionEntry): string | undefined {
  const remote = callRemote(entry);
  return remote
    ? ipFilter(remote.address, remote.port, remote.transport)
    : undefined;
}

/**
 * Display filter for a row of the destinations summary: the remote address
 * for call media, else the host name (TLS server name for https, wss and
 * files, the Host header for plain http, ws and files loaded over http).
 * Nothing for call media whose remote is not an IP address.
 *
 * @param destination A destination row
 */
export function destinationFilter(
  destination: Destination,
): string | undefined {
  if (destination.remote) {
    const { address, port, transport } = destination.remote;
    return ipFilter(address, port, transport);
  }
  if (destination.type === "call" && destination.service === "call-media") {
    return undefined;
  }
  return hostFilter(
    destination.host,
    destination.secure ??
      (destination.type !== "http" && destination.type !== "ws"),
  );
}
