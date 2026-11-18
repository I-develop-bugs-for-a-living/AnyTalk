/**
 * Per-account E2EE data of this page: the device identity and the pins.
 * Both belong to one logged in user, so accounts sharing a browser or
 * desktop profile publish different identity keys and cannot be linked, and
 * one account never sees the pins of another. The page keeps a small cache
 * that is dropped whenever the user changes or is deleted.
 */
import {
  type DeviceIdentity,
  type IdentityStore,
  loadOrCreateIdentity,
} from "./crypto";
import {
  createIndexedDbIdentityStore,
  deleteIdentity,
  deleteLegacyIdentity,
} from "./identityStore";
import {
  createPersistentPinStore,
  deleteLegacyPins,
  deletePins,
} from "./pinStore";
import type { PinStore } from "./session";

/** What the account data cache needs from storage; replaceable in tests. */
export interface AccountDataBackend {
  /** Opens the identity store of one account. */
  openIdentityStore(userId: string): IdentityStore;
  /** Opens the pin store of one account. */
  openPinStore(userId: string): PinStore;
  /** Deletes the identity of one account. */
  deleteIdentity(userId: string): Promise<void>;
  /** Deletes the pins of one account. */
  deletePins(userId: string): void;
  /** Removes the old account independent identity and pins. */
  deleteLegacy(): Promise<void>;
}

/** Cache entry: everything loaded for one user. */
interface Entry {
  userId: string;
  identity?: Promise<DeviceIdentity>;
  pins?: PinStore;
}

/** Account data of this page, one user at a time. */
export interface AccountData {
  /** Loads (or creates) the device identity of a user, cached per page and user. */
  getIdentity(userId: string): Promise<DeviceIdentity>;
  /** Returns the pin store of a user, cached per page and user. */
  getPins(userId: string): PinStore;
  /** Deletes the identity and the pins of a user and forgets the cache (logout). */
  deleteUser(userId: string): Promise<void>;
}

/** Creates the account data cache on top of a storage backend. */
export function createAccountData(backend: AccountDataBackend): AccountData {
  let entry: Entry | undefined;
  let legacy: Promise<void> | undefined;

  /** The cache entry of a user; a different user replaces the old entry. */
  const forUser = (userId: string): Entry => {
    if (entry?.userId !== userId) entry = { userId };
    return entry;
  };

  /** Drops the old shared records once per page, best effort. */
  const dropLegacy = (): Promise<void> => {
    legacy ??= backend.deleteLegacy().catch(() => {});
    return legacy;
  };

  return {
    getIdentity(userId) {
      const current = forUser(userId);
      current.identity ??= dropLegacy()
        .then(() => loadOrCreateIdentity(backend.openIdentityStore(userId)))
        .catch((err) => {
          // do not cache a failure: the next call tries again
          if (entry === current) current.identity = undefined;
          throw err;
        });
      return current.identity;
    },
    getPins(userId) {
      const current = forUser(userId);
      if (!current.pins) {
        void dropLegacy();
        current.pins = backend.openPinStore(userId);
      }
      return current.pins;
    },
    async deleteUser(userId) {
      // let a load that is still running finish first: its write must not
      // recreate the record after the delete
      const running = entry?.userId === userId ? entry.identity : undefined;
      if (entry?.userId === userId) entry = undefined;
      await running?.catch(() => {});
      backend.deletePins(userId);
      await backend.deleteIdentity(userId);
    },
  };
}

/** The account data of this page, backed by IndexedDB and localStorage. */
export const accountData = createAccountData({
  openIdentityStore: createIndexedDbIdentityStore,
  openPinStore: (userId) => createPersistentPinStore(userId),
  deleteIdentity,
  deletePins: (userId) => deletePins(userId),
  deleteLegacy: async () => {
    deleteLegacyPins();
    await deleteLegacyIdentity();
  },
});

/**
 * Deletes everything E2EE stored for a user. Call on logout. Never throws:
 * a failure only leaves the keys on this device.
 */
export async function deleteE2eeAccountData(userId: string): Promise<void> {
  try {
    await accountData.deleteUser(userId);
  } catch (err) {
    console.warn("[e2ee] could not delete the stored identity", err);
  }
}
