import {
  BaseKeyProvider,
  createKeyMaterialFromBuffer,
  isE2EESupported,
  RoomEvent,
} from "livekit-client";

/**
 * Key provider for per-participant keys. Re-exported here so the rest of the
 * app imports livekit-client's E2EE pieces from one place.
 */
export { BaseKeyProvider };

/** Re-exported so the rest of the app never imports livekit-client E2EE helpers directly. */
export { isE2EESupported, RoomEvent };

/** Minimal key sink the E2EE session needs (lets tests run without LiveKit). */
export interface KeySink {
  /** Installs a raw media key for a participant at a keyring slot. */
  setKey(raw: Uint8Array, identity: string, keyIndex: number): Promise<void>;
}

/**
 * LiveKit key provider for AnyTalk: one key per participant, no ratcheting,
 * a 16 slot keyring.
 *
 * Notes on livekit-client 2.20.2 behaviour:
 * - `onSetEncryptionKey` forwards `keyIndex !== undefined` as
 *   "update current key index". For the local identity the current index is
 *   the index frames are *sent* with, so calling `setKey` for the local
 *   identity switches the sending key at once. Rotation must therefore only
 *   call `setKey(own)` at the moment of switching, after receivers have the
 *   new key. For remote identities the "current" index is irrelevant (frames
 *   carry their own index), so setting them early is safe.
 * - On reconnect (SignalConnected) livekit re-posts every stored key and
 *   marks the one whose index equals `getLatestManuallySetKeyIndex()` as
 *   current, for every participant. The stock value is the index of the last
 *   key set for anyone, which could be a remote key and would de-select our
 *   sending key. {@link getLatestManuallySetKeyIndex} is overridden to
 *   return the local sending index.
 */
export class AnyTalkKeyProvider extends BaseKeyProvider implements KeySink {
  private readonly localIdentity: string;
  private sendingIndex = 0;

  /**
   * Creates the provider with AnyTalk's fixed options. The local identity is
   * required up front: `setKey` for that identity switches the sending key
   * and records the sending index, so the provider must know which identity
   * is local before any key is set.
   */
  constructor(localIdentity: string) {
    super({
      sharedKey: false,
      ratchetWindowSize: 0,
      failureTolerance: -1,
      keyringSize: 16,
    });
    this.localIdentity = localIdentity;
  }

  /**
   * Installs a raw 128 bit key for `identity` at `keyIndex`. For the local
   * identity this also switches the sending key (see class notes).
   */
  async setKey(
    raw: Uint8Array,
    identity: string,
    keyIndex: number,
  ): Promise<void> {
    const copy = raw.slice();
    const material = await createKeyMaterialFromBuffer(
      copy.buffer as ArrayBuffer,
    );
    if (identity === this.localIdentity) this.sendingIndex = keyIndex;
    this.onSetEncryptionKey(material, identity, keyIndex);
  }

  /** Returns the local sending index so reconnects keep the right key current. */
  override getLatestManuallySetKeyIndex(): number {
    return this.sendingIndex;
  }
}
