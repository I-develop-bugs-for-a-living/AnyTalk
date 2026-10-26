/**
 * Glue between one LiveKit `Room` and the pure E2EE session: creates the key
 * provider and worker for the room options, turns on frame encryption, runs
 * the key exchange over data messages and participant attributes, refuses
 * unencrypted tracks of others, and exposes a small reactive state for the
 * (future) UI. One instance belongs to one `Room`; a rejoin builds a new one,
 * while the device identity and the pins outlive it (module level below).
 */
import { createStore, reconcile } from "solid-js/store";

import type {
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
} from "livekit-client";

import { type DeviceIdentity, loadOrCreateIdentity } from "./crypto";
import { createIndexedDbIdentityStore } from "./identityStore";
import { AnyTalkKeyProvider, isE2EESupported, RoomEvent } from "./keyProvider";
import { createPersistentPinStore } from "./pinStore";
import {
  type E2EEEvent,
  type PeerSnapshot,
  type PinStore,
  E2EE_TOPIC,
  E2EESession,
  HELLO_ATTRIBUTE,
} from "./session";
import { E2eeWorker } from "./worker";

/** How often failed key sends are retried while a call is open. */
const RETRY_INTERVAL_MS = 5000;

/** Waits before the retries of a failed session start (so three tries in all). */
const START_RETRY_MS = [1000, 2000];

/** Reactive E2EE state for the UI. */
export interface CallE2eeState {
  /** The session is running: our key is installed and the hello published. */
  active: boolean;
  /** Why E2EE could not start, if it could not. */
  failure?: string;
  /** Trust, pending and unencrypted state per participant identity. */
  peers: Record<string, PeerSnapshot>;
  /** Whether LiveKit reports media encryption as on, per identity (own included). */
  mediaEncrypted: Record<string, boolean>;
  /** Number of decryption errors LiveKit reported in this call. */
  encryptionErrors: number;
}

/** Device identity of this page, created once and shared by all calls. */
let identityPromise: Promise<DeviceIdentity> | undefined;

/** Loads (or creates) the device identity of this page once. */
function getDeviceIdentity(): Promise<DeviceIdentity> {
  identityPromise ??= loadOrCreateIdentity(
    createIndexedDbIdentityStore(),
  ).catch((err) => {
    // do not cache a failure: the next call tries again
    identityPromise = undefined;
    throw err;
  });
  return identityPromise;
}

/** Pin store of this page, shared by all calls. */
let pinStore: PinStore | undefined;

/** Returns the shared, persistent pin store. */
function getPinStore(): PinStore {
  pinStore ??= createPersistentPinStore();
  return pinStore;
}

/** True if this browser can encrypt call media (insertable streams and WebCrypto). */
export function isCallE2eeSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof globalThis.crypto?.subtle !== "undefined" &&
    isE2EESupported()
  );
}

/** What went wrong: the worker could not load or crashed, or the key exchange could not start. */
export type E2eeFailureKind = "worker" | "start";

/** End-to-end encryption of one call. */
export class CallE2ee {
  /** Key provider for the room's `e2ee` option. */
  readonly keyProvider: AnyTalkKeyProvider;
  /** Worker for the room's `e2ee` option; terminated by {@link dispose}. */
  readonly worker: Worker;
  /** Reactive state for the UI. */
  readonly state: CallE2eeState;

  #setState: ReturnType<typeof createStore<CallE2eeState>>[1];
  #session?: E2EESession;
  #enabled?: Promise<void>;
  #cleanup: (() => void)[] = [];
  #disposed = false;
  readonly #selfId: string;
  readonly #onFailure: (kind: E2eeFailureKind) => void;

  /**
   * Creates the key provider and worker; `selfId` is our LiveKit identity
   * (the user id). Throws if the worker cannot be created. `onFailure` is
   * called when the worker crashes or the key exchange cannot start; the
   * owner must then leave the call.
   */
  constructor(selfId: string, onFailure: (kind: E2eeFailureKind) => void) {
    this.#selfId = selfId;
    this.#onFailure = onFailure;
    this.keyProvider = new AnyTalkKeyProvider(selfId);
    this.worker = new E2eeWorker();
    // addEventListener: livekit assigns worker.onerror itself
    this.worker.addEventListener("error", (event) => {
      this.#fail(`worker error: ${event.message}`);
      this.#onFailure("worker");
    });
    const [state, setState] = createStore<CallE2eeState>({
      active: false,
      peers: {},
      mediaEncrypted: {},
      encryptionErrors: 0,
    });
    // a store: consumers read it inside their own tracked scopes
    // eslint-disable-next-line solid/reactivity
    this.state = state;
    this.#setState = setState;
  }

  /** The `e2ee` option for `new Room(...)`. Not `encryption`: data messages stay readable. */
  roomOptions() {
    return { keyProvider: this.keyProvider, worker: this.worker };
  }

  /**
   * Call right after creating the room, before connecting: turns on frame
   * encryption for everything we publish and installs the downgrade guard
   * for tracks of others. Nothing is published until {@link start} resolved.
   */
  attach(room: Room): void {
    this.#enabled = room.setE2EEEnabled(true);
    this.#enabled.catch((err) =>
      this.#fail(`could not enable frame encryption: ${err}`),
    );

    const on = <A extends unknown[]>(
      event: RoomEvent,
      handler: (...args: A) => void,
    ) => {
      room.on(event, handler as never);
      this.#cleanup.push(() => room.off(event, handler as never));
    };

    on(
      RoomEvent.EncryptionError,
      (error: Error, participant?: { identity: string }) => {
        console.warn("[e2ee] encryption error", participant?.identity, error);
        this.#setState("encryptionErrors", (n) => n + 1);
      },
    );
    on(
      RoomEvent.ParticipantEncryptionStatusChanged,
      (enabled: boolean, participant?: { identity: string }) => {
        if (participant) {
          this.#setState("mediaEncrypted", participant.identity, enabled);
        }
      },
    );

    // downgrade guard: a track without encryption is never subscribed
    const guard = (
      pub: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (pub.isEncrypted) return;
      console.warn("[e2ee] refusing unencrypted track", participant.identity);
      this.#session?.reportUnencryptedTrack(participant.identity, pub.trackSid);
      if (!this.#session) {
        this.#pendingReports.push([participant.identity, pub.trackSid]);
      }
      pub.setSubscribed(false);
    };
    on(RoomEvent.TrackPublished, guard);
    on(
      RoomEvent.TrackSubscribed,
      (_track: unknown, pub: RemoteTrackPublication, p: RemoteParticipant) =>
        guard(pub, p),
    );
    on(
      RoomEvent.TrackUnpublished,
      (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        this.#session?.clearUnencryptedTrack(
          participant.identity,
          pub.trackSid,
        );
        this.#pendingReports = this.#pendingReports.filter(
          ([, sid]) => sid !== pub.trackSid,
        );
      },
    );
  }

  /** Downgrade reports made before the session existed. */
  #pendingReports: [string, string][] = [];

  /**
   * Call once connected: creates the session, publishes the hello and
   * installs our key. Resolves when it is safe to publish media; rejects if
   * E2EE could not start (the caller must then leave the call).
   */
  async start(room: Room): Promise<void> {
    try {
      await this.#enabled;
      if (room.localParticipant.identity !== this.#selfId) {
        throw new Error("the LiveKit identity is not the logged in user");
      }
      const identity = await getDeviceIdentity();
      // unique per call instance: room name plus the room's server-side id
      const callId = `${room.name}|${await room.getSid()}`;
      if (this.#disposed) return;

      const session = new E2EESession({
        callId,
        selfId: room.localParticipant.identity,
        identity,
        pins: getPinStore(),
        keySink: this.keyProvider,
        transport: {
          // only participants LiveKit shows us, never a server provided list
          getVisiblePeers: () => [...room.remoteParticipants.keys()],
          sendData: (payload, options) =>
            room.localParticipant.publishData(
              payload as Uint8Array<ArrayBuffer>,
              {
                reliable: true,
                topic: options.topic,
                destinationIdentities: options.destinationIdentities,
              },
            ),
          publishHello: (value) =>
            room.localParticipant.setAttributes({ [HELLO_ATTRIBUTE]: value }),
        },
      });
      this.#session = session;
      session.onEvent((event) => this.#onEvent(session, event));
      this.#wire(room, session);
      // a flaky connection can fail the first publish: try again a little later
      for (const wait of START_RETRY_MS) {
        await session.start();
        if (session.isStarted || this.#disposed) break;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (this.#disposed) return;
      if (!session.isStarted) await session.start();
      if (!session.isStarted) throw new Error("the key exchange did not start");
      this.#setState("active", true);

      // everyone already there, and plaintext tracks seen before the session
      for (const [identity, sid] of this.#pendingReports) {
        session.reportUnencryptedTrack(identity, sid);
      }
      this.#pendingReports = [];
      for (const p of room.remoteParticipants.values()) {
        void session.peerUpdated(p.identity, p.attributes[HELLO_ATTRIBUTE]);
        for (const pub of p.trackPublications.values()) {
          if (!pub.isEncrypted) {
            session.reportUnencryptedTrack(p.identity, pub.trackSid);
            pub.setSubscribed(false);
          }
        }
      }
    } catch (err) {
      this.#fail(String(err));
      this.#onFailure("start");
      throw err;
    }
  }

  /** Stops the session and terminates the worker. Safe to call twice. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const undo of this.#cleanup) undo();
    this.#cleanup = [];
    void this.#session?.stop();
    this.#setState("active", false);
    this.worker.terminate();
  }

  /** Records a failure for the UI and the console. */
  #fail(message: string): void {
    console.error("[e2ee]", message);
    this.#setState("failure", message);
  }

  /** Mirrors the session's peers into the reactive state. */
  #onEvent(session: E2EESession, event: E2EEEvent): void {
    if (event.type === "error") console.warn("[e2ee]", event.message);
    this.#setState(
      "peers",
      reconcile(
        Object.fromEntries(session.getPeers().map((p) => [p.identity, p])),
      ),
    );
  }

  /** Forwards room events to the session. */
  #wire(room: Room, session: E2EESession): void {
    const on = <A extends unknown[]>(
      event: RoomEvent,
      handler: (...args: A) => void,
    ) => {
      room.on(event, handler as never);
      this.#cleanup.push(() => room.off(event, handler as never));
    };

    on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      void session.peerUpdated(p.identity, p.attributes[HELLO_ATTRIBUTE]);
    });
    // on EVERY change of the attribute: the session re-checks the hello
    on(
      RoomEvent.ParticipantAttributesChanged,
      (
        changed: Record<string, string>,
        p: { identity: string; attributes: Record<string, string> },
      ) => {
        if (p.identity === room.localParticipant.identity) return;
        if (HELLO_ATTRIBUTE in changed) {
          void session.peerUpdated(p.identity, p.attributes[HELLO_ATTRIBUTE]);
        }
      },
    );
    on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      void session.peerLeft(p.identity);
    });
    on(
      RoomEvent.DataReceived,
      (
        payload: Uint8Array,
        participant?: RemoteParticipant,
        _kind?: unknown,
        topic?: string,
      ) => {
        if (topic !== E2EE_TOPIC || !participant) return;
        void session.handleData(participant.identity, topic, payload);
      },
    );
    // a full reconnect forgets attributes and may have lost messages
    on(RoomEvent.Reconnected, () => {
      void session.republishHello().then(() => session.resendAll());
    });

    // retry failed sends
    const timer = setInterval(
      () => void session.reevaluate(),
      RETRY_INTERVAL_MS,
    );
    this.#cleanup.push(() => clearInterval(timer));
  }
}
