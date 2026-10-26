/**
 * Framework-agnostic E2EE session state machine for one call.
 *
 * It knows nothing about LiveKit: the wiring injects a transport (visible
 * peers, data messages, participant attribute), a key sink, a pin store and a
 * clock, and feeds in events (`peerUpdated`, `peerLeft`, `handleData`,
 * `reportUnencryptedTrack`). The roster is only what the transport reports as
 * visible (`room.remoteParticipants`), never a server provided list, and key
 * material is never broadcast: every wrap is addressed to one recipient.
 *
 * Threat model of the default (automatic) mode: a passive or curious operator
 * and hidden ghost participants cannot decrypt media. A server that adds a
 * *visible* participant with a fresh identity can still receive keys (trust on
 * first use); making that impossible needs out-of-band verification, which
 * plugs in through {@link E2EESessionOptions.policy}.
 */
import {
  type CallKeyPair,
  type DeviceIdentity,
  b64uDecode,
  b64uEncode,
  bytesEqual,
  generateCallKeyPair,
  generateMediaKey,
  identityFingerprint,
  importCallPublicKey,
  PROTOCOL_VERSION,
  PUBLIC_KEY_LENGTH,
  randomBytes,
  SIGNATURE_LENGTH,
  signHello,
  unwrapMediaKey,
  verifyHello,
  wrapMediaKey,
} from "./crypto";
import type { KeySink } from "./keyProvider";

/** Participant attribute that carries the hello. */
export const HELLO_ATTRIBUTE = "e2ee";

/** Data message topic of all key exchange messages. */
export const E2EE_TOPIC = "anytalk:e2ee";

/** Number of slots in the keyring; key epochs map to `epoch % KEYRING_SIZE`. */
export const KEYRING_SIZE = 16;

/**
 * Trust state of a participant.
 * - `pending`: no valid hello yet ("waiting for encryption"); never refused on its own.
 * - `new`: first sighting of this device key (auto-trusted).
 * - `pinned`: key matches an earlier pin.
 * - `changed`: identity differs from a lock or changed mid-call.
 * - `unencrypted`: invalid hello or a plaintext track was reported; refuse its media.
 */
export type TrustState =
  | "pending"
  | "new"
  | "pinned"
  | "changed"
  | "unencrypted";

/** Hello content as published in the `e2ee` attribute (JSON, versioned). */
export interface Hello {
  /** Per-call ECDH public key (raw, 65 bytes). */
  callPublicKey: Uint8Array;
  /** Signature of (callId, userId, callPublicKey) by the identity key. */
  signature: Uint8Array;
  /** Device identity public key (raw, 65 bytes). */
  identityPublicKey: Uint8Array;
}

/** Serializes a hello into the attribute value. */
export function encodeHello(hello: Hello): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    k: b64uEncode(hello.callPublicKey),
    s: b64uEncode(hello.signature),
    i: b64uEncode(hello.identityPublicKey),
  });
}

/**
 * Parses an attribute value. Returns undefined for anything malformed,
 * wrongly sized or of another protocol version. Does not verify the signature.
 */
export function parseHello(value: string | undefined): Hello | undefined {
  if (!value) return undefined;
  try {
    const data = JSON.parse(value);
    if (!data || data.v !== PROTOCOL_VERSION) return undefined;
    const hello: Hello = {
      callPublicKey: b64uDecode(String(data.k)),
      signature: b64uDecode(String(data.s)),
      identityPublicKey: b64uDecode(String(data.i)),
    };
    if (
      hello.callPublicKey.length !== PUBLIC_KEY_LENGTH ||
      hello.identityPublicKey.length !== PUBLIC_KEY_LENGTH ||
      hello.signature.length !== SIGNATURE_LENGTH
    ) {
      return undefined;
    }
    return hello;
  } catch {
    return undefined;
  }
}

/** Maximum pins kept per user; stores drop the oldest beyond this. */
export const MAX_PINS_PER_USER = 8;

/** Pinned device identity of a user. */
export interface PinRecord {
  /** Identity key fingerprint (see `identityFingerprint`). */
  fingerprint: string;
  /**
   * Reserved for stricter modes: when any pin of a user is locked, an unknown
   * key for that user is `changed` instead of an additional device. Nothing
   * sets it in the automatic mode.
   */
  locked?: boolean;
}

/**
 * Synchronous pin storage (trust on first use). The wiring keeps it in memory
 * and writes through to persistent storage. The session only adds a pin once
 * keys were actually exchanged with the device.
 */
export interface PinStore {
  /** Returns all pinned device keys of a user. */
  list(userId: string): PinRecord[];
  /**
   * Adds a pin (no-op if the fingerprint is already pinned). Implementations
   * keep at most {@link MAX_PINS_PER_USER} pins, dropping the oldest.
   */
  add(userId: string, record: PinRecord): void;
}

/** Creates a pin store that lives in memory only. */
export function createMemoryPinStore(): PinStore {
  const pins = new Map<string, PinRecord[]>();
  return {
    list: (userId) => pins.get(userId) ?? [],
    add: (userId, record) => {
      const list = pins.get(userId) ?? [];
      if (!list.some((p) => p.fingerprint === record.fingerprint)) {
        pins.set(userId, [...list, record].slice(-MAX_PINS_PER_USER));
      }
    },
  };
}

/** Transport the wiring provides. */
export interface E2EETransport {
  /** Identities of the participants currently visible in the room. */
  getVisiblePeers(): string[];
  /** Sends a data message to exactly the listed identities. */
  sendData(
    payload: Uint8Array,
    options: { destinationIdentities: string[]; topic: string },
  ): Promise<void>;
  /** Publishes the hello as the `e2ee` attribute of the local participant. */
  publishHello(value: string): Promise<void>;
}

/** Clock with timers, injectable for tests. */
export interface Clock {
  /** Current time in milliseconds. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Read-only view of a peer, also passed to the trust policy. */
export interface PeerSnapshot {
  identity: string;
  trust: TrustState;
  /** Identity key fingerprint, if a valid hello was received. */
  fingerprint?: string;
  /** True once a valid hello was received. */
  hasHello: boolean;
  /** True when no hello arrived within the timeout (UI may show "waiting"). */
  helloTimedOut: boolean;
  /** True once a key was received from this peer. */
  keyReceived: boolean;
  /** True once our key was sent to this peer. */
  keySent: boolean;
}

/** Events for the (future) UI and logging. */
export type E2EEEvent =
  | { type: "trust"; peer: PeerSnapshot; previous?: TrustState }
  | {
      /** A known user shows an unknown device key (`additionalDevice`) or a different key mid-call / a locked pin mismatch. */
      type: "identity-changed";
      identity: string;
      additionalDevice: boolean;
    }
  | { type: "key-received"; identity: string; epoch: number }
  | { type: "key-sent"; identity: string; epoch: number }
  | { type: "rotated"; epoch: number }
  | { type: "hello-timeout"; identity: string }
  | { type: "unencrypted"; identity: string }
  | { type: "error"; message: string };

/** Options for {@link E2EESession}. */
export interface E2EESessionOptions {
  /**
   * Must be unique per call instance (e.g. room name plus a session id), not
   * just the channel id: it salts key derivation and binds hellos, so reusing
   * it across calls would allow replaying old hellos and wraps.
   */
  callId: string;
  /** Local user id (the LiveKit identity). */
  selfId: string;
  identity: DeviceIdentity;
  transport: E2EETransport;
  keySink: KeySink;
  pins: PinStore;
  clock?: Clock;
  /**
   * Trust policy hook: decides whether keys are exchanged with a peer that
   * has a valid hello. Default: always (automatic mode). A future verified
   * mode returns false for unverified or changed peers. Call
   * {@link E2EESession.reevaluate} after its answer changes.
   */
  policy?: (peer: PeerSnapshot) => boolean;
  /** Time to wait for acks before switching the sending key. Default 300 ms. */
  graceMs?: number;
  /** Time without a hello before `helloTimedOut` is set (never refuses). Default 5000 ms. */
  helloTimeoutMs?: number;
}

/** Replay state for one call key of a peer. */
interface CallSession {
  lastEpoch: number;
  nonces: Set<string>;
}

/** Internal per-peer state. */
interface Peer {
  identity: string;
  hello?: Hello;
  callKey?: CryptoKey;
  fingerprint?: string;
  /** Result of the pin lookup for the current identity key. */
  identityTrust?: "new" | "pinned" | "changed";
  /** A hello arrived that was malformed or badly signed (before any valid one). */
  invalid: boolean;
  /** A valid hello with a different identity key arrived mid-call. Blocks keys. */
  swapped: boolean;
  /** Track ids reported as plaintext (downgrade); cleared per track. */
  unencryptedTracks: Set<string>;
  trust: TrustState;
  /**
   * Replay state per call key. A hello flipping back to an older call key
   * resumes that key's state, so epochs never go backwards.
   */
  sessions: Map<string, CallSession>;
  active?: CallSession;
  keySent: boolean;
  keyReceived: boolean;
  pinCommitted: boolean;
  helloTimedOut: boolean;
  helloTimer?: unknown;
  /** Messages that arrived before the hello (or the start); replayed later. */
  buffered: { payload: Uint8Array; at: number }[];
  /** Timer of the next key request while no key arrived. */
  requestTimer?: unknown;
  /** Key requests sent for the current call key. */
  requests: number;
  /** When a request of this peer was last answered. */
  lastRequestHandled: number;
}

/** A rotated key waiting for acks before it becomes the sending key. */
interface PendingKey {
  epoch: number;
  key: Uint8Array;
  /** Wrap nonce expected back in the ack, per peer still outstanding. */
  waiting: Map<string, string>;
  timer?: unknown;
}

/** Maximum number of remembered nonces per call key of a peer. */
const MAX_NONCES = 256;

/** Messages kept per peer that arrive before its hello. */
const MAX_BUFFERED = 4;

/** How long a message that arrived before the hello is kept. */
const BUFFER_TTL_MS = 10_000;

/** Wait before asking a peer for its key when none arrived. */
const REQUEST_FIRST_MS = 3000;

/** Wait between repeated key requests. */
const REQUEST_REPEAT_MS = 5000;

/** Maximum key requests per call key of a peer. */
const MAX_REQUESTS = 5;

/** Minimum time between two answered key requests of one peer. */
const REQUEST_MIN_INTERVAL_MS = 1000;

/** Maximum number of remembered call keys per peer. */
const MAX_CALL_SESSIONS = 4;

/** Shared UTF-8 encoder for message payloads. */
const encoder = new TextEncoder();

/** Shared UTF-8 decoder for message payloads. */
const decoder = new TextDecoder();

/** Real clock based on the global timer functions. */
const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
};

/**
 * End-to-end encryption session for one call.
 *
 * Multi-device decision: pins are per (userId, identity key). A user with
 * pins who shows an unknown key is a new device: trust `new`, an
 * `identity-changed` event with `additionalDevice: true` lets the UI show a
 * low-key notice, and the key is pinned once keys were exchanged. Only if one
 * of the user's pins is `locked` (reserved for a future verified mode) the
 * unknown key is `changed` (non-blocking). A server can fake a "new device",
 * but in automatic mode it could equally fake a first sighting; verification
 * closes that gap, via the policy hook.
 *
 * Mid-call identity swap: once a peer has a valid hello, a later hello with a
 * different identity key is refused: trust `changed`, no keys are exchanged
 * with that peer for the rest of its stay, and an event is emitted. A new
 * call key signed by the same identity is accepted (re-key).
 *
 * Known limit: old keys stay in receivers' keyrings (16 slots) until
 * overwritten, so a peer that left can still decrypt what was encrypted with
 * keys it held, and an old key may remain usable for up to 16 rotations.
 */
export class E2EESession {
  private readonly options: E2EESessionOptions;
  private readonly clock: Clock;
  private readonly graceMs: number;
  private readonly helloTimeoutMs: number;
  private readonly peers = new Map<string, Peer>();
  private readonly listeners = new Set<(event: E2EEEvent) => void>();
  private chain: Promise<void> = Promise.resolve();
  private callKeys?: CallKeyPair;
  private started = false;
  private stopped = false;
  private currentEpoch = 0;
  private currentKey?: Uint8Array;
  private pending?: PendingKey;
  private helloValue?: string;

  /** Creates a session. Call {@link start} to publish the hello. */
  constructor(options: E2EESessionOptions) {
    this.options = options;
    this.clock = options.clock ?? realClock;
    this.graceMs = options.graceMs ?? 300;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
  }

  /** Subscribes to events. Returns the unsubscribe function. */
  onEvent(listener: (event: E2EEEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves when all queued work has finished (for tests and shutdown). */
  idle(): Promise<void> {
    return this.chain;
  }

  /**
   * Generates the per-call key and the first media key, publishes the hello
   * and installs the own sending key. Afterwards the wiring calls
   * {@link peerUpdated} for every visible remote participant. If a step
   * fails the session stays not started and `start()` can be retried.
   */
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.started) return;
      const callKeys = await generateCallKeyPair();
      const signature = await signHello(
        this.options.identity.privateKey,
        this.options.callId,
        this.options.selfId,
        callKeys.publicRaw,
      );
      const key = generateMediaKey();
      await this.options.keySink.setKey(key, this.options.selfId, 0);
      const helloValue = encodeHello({
        callPublicKey: callKeys.publicRaw,
        signature,
        identityPublicKey: this.options.identity.publicRaw,
      });
      await this.options.transport.publishHello(helloValue);
      this.helloValue = helloValue;
      this.callKeys = callKeys;
      this.currentKey = key;
      this.currentEpoch = 0;
      this.started = true;
      // peers whose hello arrived before start get the key now
      await this.reconcile();
      for (const peer of this.peers.values()) await this.drain(peer);
    });
  }

  /** True once {@link start} finished: the own key is installed and the hello published. */
  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Publishes the same hello again (e.g. after a full reconnect, which
   * forgets participant attributes). Does nothing before start.
   */
  republishHello(): Promise<void> {
    return this.enqueue(async () => {
      if (this.helloValue) {
        await this.options.transport.publishHello(this.helloValue);
      }
    });
  }

  /** Stops the session and clears timers. Later input is ignored. */
  stop(): Promise<void> {
    this.stopped = true;
    for (const peer of this.peers.values()) {
      this.clearHelloTimer(peer);
      this.clearRequestTimer(peer);
    }
    if (this.pending?.timer !== undefined) {
      this.clock.clearTimeout(this.pending.timer);
    }
    this.pending = undefined;
    return this.idle();
  }

  /**
   * Call when a visible peer joined and on EVERY change of its `e2ee`
   * attribute (`value` undefined when it has none); the hello timeout
   * restarts on each call while no valid hello is known. Peers not in the
   * visible roster are ignored.
   */
  peerUpdated(identity: string, value: string | undefined): Promise<void> {
    return this.enqueue(async () => {
      const peer = this.ensurePeer(identity);
      if (!peer) return;
      await this.evaluateHello(peer, value);
    });
  }

  /** Call when a peer left. Rotates the own key if the peer held it. */
  peerLeft(identity: string): Promise<void> {
    return this.enqueue(async () => {
      const peer = this.peers.get(identity);
      if (!peer) return;
      this.clearHelloTimer(peer);
      this.clearRequestTimer(peer);
      this.peers.delete(identity);
      if (
        this.pending?.waiting.delete(identity) &&
        !this.pending.waiting.size
      ) {
        await this.switchNow();
      }
      if (peer.keySent) await this.rotate();
    });
  }

  /**
   * Re-checks every peer against the current policy and state: peers that
   * must no longer hold our key trigger a rotation, newly allowed peers (and
   * peers whose earlier send failed) get the key. Call it after the policy
   * answer changed, and to retry failed sends.
   */
  reevaluate(): Promise<void> {
    return this.enqueue(() => this.reconcile());
  }

  /** Call for every incoming data message of the room. */
  handleData(
    sender: string,
    topic: string | undefined,
    payload: Uint8Array,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (topic !== E2EE_TOPIC) return;
      // only visible peers may talk to us
      const peer = this.ensurePeer(sender);
      if (!peer) return;
      if (!peer.hello || !peer.callKey || !this.started) {
        // the hello (or our start) is still on its way: keep a few messages
        const now = this.clock.now();
        peer.buffered = peer.buffered
          .filter((m) => now - m.at < BUFFER_TTL_MS)
          .concat({ payload, at: now })
          .slice(-MAX_BUFFERED);
        return;
      }
      await this.process(peer, payload);
    });
  }

  /** Handles one message of a peer that has a valid hello. */
  private async process(peer: Peer, payload: Uint8Array): Promise<void> {
    if (!this.allowed(peer)) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(decoder.decode(payload));
    } catch {
      return;
    }
    if (
      !message ||
      message.v !== PROTOCOL_VERSION ||
      message.call !== this.options.callId ||
      message.from !== peer.identity ||
      message.to !== this.options.selfId ||
      typeof message.epoch !== "number" ||
      !Number.isInteger(message.epoch) ||
      message.epoch < 0 ||
      typeof message.n !== "string"
    ) {
      return;
    }
    if (message.t === "wrap") await this.onWrap(peer, message);
    else if (message.t === "ack") await this.onAck(peer, message);
    else if (message.t === "req") await this.onRequest(peer);
  }

  /** Replays the messages that arrived early, once hello and start are there. */
  private async drain(peer: Peer): Promise<void> {
    if (!peer.hello || !peer.callKey || !this.started) return;
    const now = this.clock.now();
    const messages = peer.buffered.filter((m) => now - m.at < BUFFER_TTL_MS);
    peer.buffered = [];
    for (const m of messages) await this.process(peer, m.payload);
  }

  /**
   * Marks every key as not sent and sends them again. For the wiring to call
   * after a full reconnect, which may have lost messages.
   */
  resendAll(): Promise<void> {
    return this.enqueue(async () => {
      for (const peer of this.peers.values()) peer.keySent = false;
      await this.reconcile();
    });
  }

  /**
   * Downgrade signal: track `trackSid` of `identity` arrived without
   * encryption. The peer becomes `unencrypted` and gets no keys while any
   * reported track is outstanding; a later valid hello does NOT clear it. The
   * return value tells the wiring to refuse (mute or unsubscribe) the track.
   * Call {@link clearUnencryptedTrack} when the track is gone.
   */
  reportUnencryptedTrack(identity: string, trackSid: string): { refuse: true } {
    const peer = this.ensurePeer(identity);
    if (peer) {
      peer.unencryptedTracks.add(trackSid);
      this.refreshTrust(peer);
      void this.reevaluate();
    }
    return { refuse: true };
  }

  /** Forgets a reported plaintext track (e.g. it was unpublished). */
  clearUnencryptedTrack(identity: string, trackSid: string): void {
    const peer = this.peers.get(identity);
    if (!peer) return;
    peer.unencryptedTracks.delete(trackSid);
    this.refreshTrust(peer);
    void this.reevaluate();
  }

  /** Returns a snapshot of one peer. */
  getPeer(identity: string): PeerSnapshot | undefined {
    const peer = this.peers.get(identity);
    return peer ? this.snapshot(peer) : undefined;
  }

  /** Returns snapshots of all known peers. */
  getPeers(): PeerSnapshot[] {
    return [...this.peers.values()].map((p) => this.snapshot(p));
  }

  /** Queues work so handlers never interleave. Errors become `error` events. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.stopped) return;
      try {
        await task();
      } catch (error) {
        this.emit({ type: "error", message: String(error) });
      }
    });
    return this.chain;
  }

  /** Delivers an event to all listeners. */
  private emit(event: E2EEEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** True if the transport reports the identity as visible. */
  private isVisible(identity: string): boolean {
    return this.options.transport.getVisiblePeers().includes(identity);
  }

  /** Builds the public view of a peer. */
  private snapshot(peer: Peer): PeerSnapshot {
    return {
      identity: peer.identity,
      trust: peer.trust,
      fingerprint: peer.fingerprint,
      hasHello: !!peer.hello,
      helloTimedOut: peer.helloTimedOut,
      keyReceived: peer.keyReceived,
      keySent: peer.keySent,
    };
  }

  /** Computes the trust state from the peer's flags. */
  private computeTrust(peer: Peer): TrustState {
    if (peer.invalid || peer.unencryptedTracks.size) return "unencrypted";
    if (peer.swapped) return "changed";
    if (!peer.hello) return "pending";
    return peer.identityTrust ?? "pending";
  }

  /** Recomputes the trust state and emits events if it changed. */
  private refreshTrust(peer: Peer): void {
    const trust = this.computeTrust(peer);
    if (trust === peer.trust) return;
    const previous = peer.trust;
    peer.trust = trust;
    this.emit({ type: "trust", peer: this.snapshot(peer), previous });
    if (trust === "unencrypted") {
      this.emit({ type: "unencrypted", identity: peer.identity });
    }
  }

  /** Whether keys may be exchanged with this peer (valid hello plus policy). */
  private allowed(peer: Peer): boolean {
    return (
      !!peer.hello &&
      !peer.invalid &&
      !peer.swapped &&
      peer.unencryptedTracks.size === 0 &&
      (this.options.policy?.(this.snapshot(peer)) ?? true)
    );
  }

  /**
   * Gets or creates a peer and (re)starts its hello timeout. Returns
   * undefined for identities that are not visible, so the server cannot make
   * us track ghosts.
   */
  private ensurePeer(identity: string): Peer | undefined {
    if (!this.isVisible(identity)) return undefined;
    let peer = this.peers.get(identity);
    if (!peer) {
      peer = {
        identity,
        invalid: false,
        swapped: false,
        unencryptedTracks: new Set(),
        trust: "pending",
        sessions: new Map(),
        keySent: false,
        keyReceived: false,
        pinCommitted: false,
        helloTimedOut: false,
        buffered: [],
        requests: 0,
        lastRequestHandled: -Infinity,
      };
      this.peers.set(identity, peer);
    }
    if (!peer.hello) this.armHelloTimer(peer);
    return peer;
  }

  /** (Re)starts the hello timeout of a peer. */
  private armHelloTimer(peer: Peer): void {
    this.clearHelloTimer(peer);
    peer.helloTimer = this.clock.setTimeout(() => {
      void this.enqueue(async () => {
        // ignore timers of a peer object that has left or was replaced
        if (this.peers.get(peer.identity) !== peer || peer.hello) return;
        peer.helloTimedOut = true;
        this.emit({ type: "hello-timeout", identity: peer.identity });
      });
    }, this.helloTimeoutMs);
  }

  /** Clears the hello timeout of a peer. */
  private clearHelloTimer(peer: Peer): void {
    if (peer.helloTimer !== undefined) this.clock.clearTimeout(peer.helloTimer);
    peer.helloTimer = undefined;
  }

  /** Validates a hello, applies TOFU lookup and sends keys if allowed. */
  private async evaluateHello(
    peer: Peer,
    value: string | undefined,
  ): Promise<void> {
    if (value === undefined) return; // timer was restarted in ensurePeer
    const hello = parseHello(value);
    let callKey: CryptoKey | undefined;
    if (hello) {
      const valid = await verifyHello(
        hello.identityPublicKey,
        this.options.callId,
        peer.identity,
        hello.callPublicKey,
        hello.signature,
      );
      if (valid) {
        try {
          callKey = await importCallPublicKey(hello.callPublicKey);
        } catch {
          callKey = undefined;
        }
      }
    }
    if (!hello || !callKey) {
      // a bad update never overrides a good hello; before one it is evidence
      if (!peer.hello) {
        peer.invalid = true;
        this.clearHelloTimer(peer);
        this.refreshTrust(peer);
      }
      return;
    }
    const fingerprint = await identityFingerprint(hello.identityPublicKey);

    if (peer.hello && peer.fingerprint !== fingerprint) {
      // different device identity mid-call: refuse and stop sharing keys
      if (!peer.swapped) {
        peer.swapped = true;
        this.emit({
          type: "identity-changed",
          identity: peer.identity,
          additionalDevice: false,
        });
        this.refreshTrust(peer);
        await this.reconcile();
      }
      return;
    }

    // compare decoded keys, not the attribute string: the string is malleable
    if (
      peer.hello &&
      bytesEqual(peer.hello.callPublicKey, hello.callPublicKey)
    ) {
      return;
    }

    const first = !peer.hello;
    peer.hello = hello;
    peer.callKey = callKey;
    peer.invalid = false;
    peer.helloTimedOut = false;
    this.clearHelloTimer(peer);
    // replay state is kept per call key and never reset for a known key
    const id = b64uEncode(hello.callPublicKey);
    let session = peer.sessions.get(id);
    if (!session) {
      session = { lastEpoch: -1, nonces: new Set() };
      peer.sessions.set(id, session);
      if (peer.sessions.size > MAX_CALL_SESSIONS) {
        peer.sessions.delete(peer.sessions.keys().next().value as string);
      }
    }
    peer.active = session;
    // the peer has a new call key: it has none of our wraps under it yet
    peer.keySent = false;
    if (first) {
      peer.fingerprint = fingerprint;
      peer.identityTrust = this.lookupTrust(peer.identity, fingerprint);
    }
    this.refreshTrust(peer);
    peer.requests = 0;
    // the new call key has not delivered a key of the peer yet
    peer.keyReceived = false;
    this.scheduleRequest(peer, REQUEST_FIRST_MS);
    await this.reconcile();
    await this.drain(peer);
  }

  /** Clears the key request timer of a peer. */
  private clearRequestTimer(peer: Peer): void {
    if (peer.requestTimer !== undefined) {
      this.clock.clearTimeout(peer.requestTimer);
    }
    peer.requestTimer = undefined;
  }

  /**
   * Asks the peer for its key after `ms` if none arrived by then, and keeps
   * asking (a limited number of times). Covers messages lost around joins
   * and reconnects.
   */
  private scheduleRequest(peer: Peer, ms: number): void {
    this.clearRequestTimer(peer);
    peer.requestTimer = this.clock.setTimeout(() => {
      void this.enqueue(async () => {
        peer.requestTimer = undefined;
        if (this.peers.get(peer.identity) !== peer) return;
        if (peer.keyReceived) return;
        // not allowed right now (e.g. a reported track): look again later
        if (
          !this.allowed(peer) ||
          !this.started ||
          !this.isVisible(peer.identity)
        ) {
          this.scheduleRequest(peer, REQUEST_REPEAT_MS);
          return;
        }
        if (peer.requests >= MAX_REQUESTS) return;
        peer.requests++;
        try {
          await this.options.transport.sendData(
            encoder.encode(
              JSON.stringify({
                t: "req",
                v: PROTOCOL_VERSION,
                call: this.options.callId,
                from: this.options.selfId,
                to: peer.identity,
                epoch: 0,
                n: b64uEncode(randomBytes(16)),
              }),
            ),
            { destinationIdentities: [peer.identity], topic: E2EE_TOPIC },
          );
        } catch (error) {
          this.emit({ type: "error", message: String(error) });
        }
        this.scheduleRequest(peer, REQUEST_REPEAT_MS);
      });
    }, ms);
  }

  /** A peer asks for our key again: send it (rate limited). */
  private async onRequest(peer: Peer): Promise<void> {
    const now = this.clock.now();
    if (now - peer.lastRequestHandled < REQUEST_MIN_INTERVAL_MS) return;
    peer.lastRequestHandled = now;
    peer.keySent = false;
    await this.reconcile();
  }

  /** Pin lookup for a (user, identity key) pair. Does not write pins. */
  private lookupTrust(
    userId: string,
    fingerprint: string,
  ): "new" | "pinned" | "changed" {
    const pins = this.options.pins.list(userId);
    if (pins.some((p) => p.fingerprint === fingerprint)) return "pinned";
    if (pins.some((p) => p.locked)) {
      this.emit({
        type: "identity-changed",
        identity: userId,
        additionalDevice: false,
      });
      return "changed";
    }
    if (pins.length > 0) {
      this.emit({
        type: "identity-changed",
        identity: userId,
        additionalDevice: true,
      });
    }
    return "new";
  }

  /** Persists the pin of a first-seen device once keys were exchanged. */
  private commitPin(peer: Peer): void {
    if (
      peer.pinCommitted ||
      peer.identityTrust !== "new" ||
      !peer.fingerprint
    ) {
      return;
    }
    peer.pinCommitted = true;
    this.options.pins.add(peer.identity, { fingerprint: peer.fingerprint });
  }

  /**
   * Brings key distribution in line with the current state: peers that hold
   * our key but are no longer allowed trigger one rotation, then every
   * allowed peer without our key gets it.
   */
  private async reconcile(): Promise<void> {
    let demoted = false;
    for (const peer of this.peers.values()) {
      if (peer.keySent && !this.allowed(peer)) {
        peer.keySent = false;
        demoted = true;
      }
    }
    if (demoted) await this.rotate();
    for (const peer of this.peers.values()) await this.maybeSendKeys(peer);
  }

  /**
   * Sends the current (and pending) key to a peer if not done yet. `keySent`
   * is set only after the sends succeeded, so failures can be retried.
   */
  private async maybeSendKeys(peer: Peer): Promise<void> {
    if (!this.started || !this.currentKey || peer.keySent) return;
    if (!this.allowed(peer) || !this.isVisible(peer.identity)) return;
    try {
      await this.sendWrap(peer, this.currentEpoch, this.currentKey);
      const pending = this.pending;
      if (pending) {
        const nonce = await this.sendWrap(peer, pending.epoch, pending.key);
        pending.waiting.set(peer.identity, nonce);
      }
      peer.keySent = true;
    } catch (error) {
      this.emit({ type: "error", message: String(error) });
    }
  }

  /** Wraps a key to one peer and sends it. Returns the wrap nonce. */
  private async sendWrap(
    peer: Peer,
    epoch: number,
    key: Uint8Array,
  ): Promise<string> {
    if (!this.callKeys || !peer.hello) throw new Error("not ready");
    const wrapped = await wrapMediaKey(
      this.callKeys.privateKey,
      peer.hello.callPublicKey,
      this.context(this.options.selfId, peer.identity, epoch),
      key,
    );
    const nonce = b64uEncode(randomBytes(16));
    await this.options.transport.sendData(
      encoder.encode(
        JSON.stringify({
          t: "wrap",
          v: PROTOCOL_VERSION,
          call: this.options.callId,
          from: this.options.selfId,
          to: peer.identity,
          epoch,
          n: nonce,
          iv: b64uEncode(wrapped.iv),
          ct: b64uEncode(wrapped.ciphertext),
        }),
      ),
      { destinationIdentities: [peer.identity], topic: E2EE_TOPIC },
    );
    this.emit({ type: "key-sent", identity: peer.identity, epoch });
    return nonce;
  }

  /** Wrap context; the key epoch is bound as the key index. */
  private context(from: string, to: string, epoch: number) {
    return { callId: this.options.callId, from, to, keyIndex: epoch };
  }

  /** Handles a received wrap: replay checks, unwrap, install, ack. */
  private async onWrap(
    peer: Peer,
    message: Record<string, unknown>,
  ): Promise<void> {
    const epoch = message.epoch as number;
    const nonce = message.n as string;
    const session = peer.active;
    if (!session || !this.callKeys || !peer.hello) return;
    // replay protection: unseen nonce and an epoch that never goes back
    // (the same epoch is fine with a fresh nonce: a re-sent wrap after a loss)
    if (session.nonces.has(nonce) || epoch < session.lastEpoch) return;
    let key: Uint8Array;
    try {
      key = await unwrapMediaKey(
        this.callKeys.privateKey,
        peer.hello.callPublicKey,
        this.context(peer.identity, this.options.selfId, epoch),
        {
          iv: b64uDecode(String(message.iv)),
          ciphertext: b64uDecode(String(message.ct)),
        },
      );
    } catch {
      return; // wrong recipient, index, call or tampered: drop silently
    }
    session.nonces.add(nonce);
    if (session.nonces.size > MAX_NONCES) {
      session.nonces.delete(session.nonces.values().next().value as string);
    }
    session.lastEpoch = epoch;
    peer.keyReceived = true;
    this.clearRequestTimer(peer);
    await this.options.keySink.setKey(key, peer.identity, epoch % KEYRING_SIZE);
    this.commitPin(peer);
    this.emit({ type: "key-received", identity: peer.identity, epoch });
    // ack is a plain message; it only speeds up the sender's key switch
    await this.options.transport.sendData(
      encoder.encode(
        JSON.stringify({
          t: "ack",
          v: PROTOCOL_VERSION,
          call: this.options.callId,
          from: this.options.selfId,
          to: peer.identity,
          epoch,
          n: nonce,
        }),
      ),
      { destinationIdentities: [peer.identity], topic: E2EE_TOPIC },
    );
  }

  /** Handles an ack for the pending key. */
  private async onAck(
    peer: Peer,
    message: Record<string, unknown>,
  ): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.epoch !== message.epoch) return;
    if (pending.waiting.get(peer.identity) !== message.n) return;
    pending.waiting.delete(peer.identity);
    if (!pending.waiting.size) await this.switchNow();
  }

  /**
   * Generates the next key (next epoch, next keyring slot), sends it to all
   * peers that hold the old one and switches the sending key after all acks
   * or the grace period. Receivers install it as soon as it arrives. The
   * grace timer starts before the sends so slow sends cannot delay it.
   */
  private async rotate(): Promise<void> {
    if (!this.started) return;
    if (this.pending) await this.switchNow();
    const epoch = this.currentEpoch + 1;
    const key = generateMediaKey();
    const recipients = [...this.peers.values()].filter(
      (p) => p.keySent && this.allowed(p) && this.isVisible(p.identity),
    );
    const pending: PendingKey = { epoch, key, waiting: new Map() };
    this.pending = pending;
    pending.timer = this.clock.setTimeout(() => {
      void this.enqueue(async () => {
        if (this.pending === pending) await this.switchNow();
      });
    }, this.graceMs);
    for (const peer of recipients) {
      try {
        pending.waiting.set(
          peer.identity,
          await this.sendWrap(peer, epoch, key),
        );
      } catch (error) {
        // retried by reevaluate(); it will get the then-current key
        peer.keySent = false;
        this.emit({ type: "error", message: String(error) });
      }
    }
    if (!pending.waiting.size) await this.switchNow();
  }

  /** Makes the pending key the sending key. */
  private async switchNow(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    if (pending.timer !== undefined) this.clock.clearTimeout(pending.timer);
    this.currentEpoch = pending.epoch;
    this.currentKey = pending.key;
    await this.options.keySink.setKey(
      pending.key,
      this.options.selfId,
      pending.epoch % KEYRING_SIZE,
    );
    this.emit({ type: "rotated", epoch: pending.epoch });
  }
}
