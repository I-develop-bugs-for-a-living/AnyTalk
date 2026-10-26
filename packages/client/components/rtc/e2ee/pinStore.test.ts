import { describe, expect, it } from "vitest";

import { type PinStorage, createPersistentPinStore } from "./pinStore";
import { MAX_PINS_PER_USER } from "./session";

/** In-memory stand-in for localStorage. */
function fakeStorage(initial?: string): PinStorage & { value?: string } {
  const storage = {
    value: initial,
    getItem: () => storage.value ?? null,
    setItem: (_key: string, value: string) => {
      storage.value = value;
    },
  };
  return storage;
}

describe("createPersistentPinStore", () => {
  it("persists pins and reads them back", () => {
    const storage = fakeStorage();
    createPersistentPinStore(storage).add("alice", { fingerprint: "a" });
    expect(createPersistentPinStore(storage).list("alice")).toEqual([
      { fingerprint: "a" },
    ]);
  });
  it("keeps only the most recent pins per user", () => {
    const store = createPersistentPinStore(fakeStorage());
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
    const tabA = createPersistentPinStore(storage);
    const tabB = createPersistentPinStore(storage);
    tabA.add("alice", { fingerprint: "a" });
    tabB.add("alice", { fingerprint: "b" });
    expect(
      createPersistentPinStore(storage)
        .list("alice")
        .map((p) => p.fingerprint)
        .sort(),
    ).toEqual(["a", "b"]);
  });
  it("survives garbage and failing storage", () => {
    expect(createPersistentPinStore(fakeStorage("{{")).list("a")).toEqual([]);
    const broken: PinStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    const store = createPersistentPinStore(broken);
    store.add("a", { fingerprint: "x" });
    expect(store.list("a").length).toBe(1);
  });
});
