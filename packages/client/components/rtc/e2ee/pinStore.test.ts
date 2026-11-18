import { describe, expect, it } from "vitest";

import {
  type PinStorage,
  createPersistentPinStore,
  deleteLegacyPins,
  deletePins,
} from "./pinStore";
import { MAX_PINS_PER_USER } from "./session";

/** In-memory stand-in for localStorage; `initial` is stored under every key read. */
function fakeStorage(initial?: string): PinStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  const storage = {
    values,
    getItem: (key: string) => values.get(key) ?? initial ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  return storage;
}

describe("createPersistentPinStore", () => {
  it("persists pins and reads them back", () => {
    const storage = fakeStorage();
    createPersistentPinStore("me", storage).add("alice", { fingerprint: "a" });
    expect(createPersistentPinStore("me", storage).list("alice")).toEqual([
      { fingerprint: "a" },
    ]);
  });
  it("keeps only the most recent pins per user", () => {
    const store = createPersistentPinStore("me", fakeStorage());
    for (let i = 0; i < MAX_PINS_PER_USER + 3; i++) {
      store.add("alice", { fingerprint: `f${i}` });
    }
    expect(store.list("alice").length).toBe(MAX_PINS_PER_USER);
    expect(store.list("alice").at(-1)?.fingerprint).toBe(
      `f${MAX_PINS_PER_USER + 2}`,
    );
  });
  it("merges pins another tab wrote before writing", () => {
    const storage = fakeStorage();
    const tabA = createPersistentPinStore("me", storage);
    const tabB = createPersistentPinStore("me", storage);
    tabA.add("alice", { fingerprint: "a" });
    tabB.add("alice", { fingerprint: "b" });
    expect(
      createPersistentPinStore("me", storage)
        .list("alice")
        .map((p) => p.fingerprint)
        .sort(),
    ).toEqual(["a", "b"]);
  });
  it("survives garbage and failing storage", () => {
    expect(createPersistentPinStore("me", fakeStorage("{{")).list("a")).toEqual(
      [],
    );
    const broken: PinStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createPersistentPinStore("me", broken);
    store.add("a", { fingerprint: "x" });
    expect(store.list("a").length).toBe(1);
  });
  it("keeps the pins of each account apart", () => {
    const storage = fakeStorage();
    createPersistentPinStore("me", storage).add("alice", { fingerprint: "a" });
    expect(createPersistentPinStore("other", storage).list("alice")).toEqual(
      [],
    );
    expect(createPersistentPinStore("me", storage).list("alice").length).toBe(
      1,
    );
  });
  it("deletes the pins of one account only, and the legacy shared key", () => {
    const storage = fakeStorage();
    createPersistentPinStore("me", storage).add("alice", { fingerprint: "a" });
    createPersistentPinStore("other", storage).add("alice", {
      fingerprint: "b",
    });
    storage.setItem("anytalk:e2ee:pins", "{}");
    deletePins("me", storage);
    deleteLegacyPins(storage);
    expect(createPersistentPinStore("me", storage).list("alice")).toEqual([]);
    expect(
      createPersistentPinStore("other", storage).list("alice").length,
    ).toBe(1);
    expect(storage.getItem("anytalk:e2ee:pins")).toBeNull();
    // a blocked storage never throws
    expect(() =>
      deletePins("me", {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
