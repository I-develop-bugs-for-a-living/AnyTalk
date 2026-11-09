import type { IdentityStore, StoredIdentity } from "./crypto";

/** Name of the IndexedDB database. */
const DB_NAME = "anytalk-e2ee";

/** Name of the object store that holds the identity. */
const STORE_NAME = "identity";

/** Key of the single identity record. */
const RECORD_KEY = "device";

/** Creates a store that only lives in memory (lost on reload). */
export function createMemoryIdentityStore(): IdentityStore {
  let identity: StoredIdentity | undefined;
  return {
    load: async () => identity,
    addIfAbsent: async (value) => {
      if (identity) return false;
      identity = value;
      return true;
    },
  };
}

/** Opens the IndexedDB database, creating the object store on first use. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs one request against the identity object store and resolves its result. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(
        db.transaction(STORE_NAME, mode).objectStore(STORE_NAME),
      );
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Creates an IndexedDB backed identity store (CryptoKey objects are stored
 * through structured clone, so the private key stays non-extractable).
 * It rejects on any IndexedDB failure; `loadOrCreateIdentity` catches that
 * and falls back to an in-memory identity without overwriting the record.
 * Creation uses `add()`, which fails if the key exists, so two tabs cannot
 * overwrite each other's identity.
 */
export function createIndexedDbIdentityStore(): IdentityStore {
  return {
    load: () =>
      withStore("readonly", (s) => s.get(RECORD_KEY)) as Promise<
        StoredIdentity | undefined
      >,
    async addIfAbsent(identity) {
      try {
        await withStore("readwrite", (s) => s.add(identity, RECORD_KEY));
        return true;
      } catch (error) {
        // the key already exists: another tab won the race
        if ((error as DOMException | undefined)?.name === "ConstraintError") {
          return false;
        }
        throw error;
      }
    },
  };
}
