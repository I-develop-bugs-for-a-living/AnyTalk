import { describe, expect, it, vi } from "vitest";

import { type AccountDataBackend, createAccountData } from "./accountData";
import { createMemoryIdentityStore } from "./identityStore";
import { createMemoryPinStore } from "./session";

/** In-memory backend: one identity store and pin store per user. */
function memoryBackend() {
  const identities = new Map<
    string,
    ReturnType<typeof createMemoryIdentityStore>
  >();
  const pins = new Map<string, ReturnType<typeof createMemoryPinStore>>();
  const backend: AccountDataBackend & { legacyDeleted: number } = {
    legacyDeleted: 0,
    openIdentityStore: (id) => {
      if (!identities.has(id)) identities.set(id, createMemoryIdentityStore());
      return identities.get(id)!;
    },
    openPinStore: (id) => {
      if (!pins.has(id)) pins.set(id, createMemoryPinStore());
      return pins.get(id)!;
    },
    deleteIdentity: vi.fn(async (id: string) => void identities.delete(id)),
    deletePins: vi.fn((id: string) => void pins.delete(id)),
    deleteLegacy: async () => {
      backend.legacyDeleted++;
    },
  };
  return backend;
}

describe("account data", () => {
  it("gives every account its own identity and keeps it per account", async () => {
    const data = createAccountData(memoryBackend());
    const alice = await data.getIdentity("alice");
    const bob = await data.getIdentity("bob");
    expect(alice.publicRaw).not.toEqual(bob.publicRaw);
    // switching back keeps the stored identity of the account
    expect((await data.getIdentity("alice")).publicRaw).toEqual(
      alice.publicRaw,
    );
  });

  it("does not reuse the cached identity or pins for another user", async () => {
    const data = createAccountData(memoryBackend());
    await data.getIdentity("alice");
    data.getPins("alice").add("carol", { fingerprint: "f" });
    expect(data.getPins("bob").list("carol")).toEqual([]);
    expect(data.getPins("alice").list("carol").length).toBe(1);
  });

  it("deletes identity and pins on logout, so the next login makes a new identity", async () => {
    const backend = memoryBackend();
    const data = createAccountData(backend);
    const first = await data.getIdentity("alice");
    data.getPins("alice").add("carol", { fingerprint: "f" });
    await data.deleteUser("alice");
    expect(backend.deleteIdentity).toHaveBeenCalledWith("alice");
    expect(backend.deletePins).toHaveBeenCalledWith("alice");
    const second = await data.getIdentity("alice");
    expect(second.publicRaw).not.toEqual(first.publicRaw);
    expect(data.getPins("alice").list("carol")).toEqual([]);
  });

  it("drops the legacy shared records once and never adopts them", async () => {
    const backend = memoryBackend();
    const data = createAccountData(backend);
    await data.getIdentity("alice");
    await data.getIdentity("alice");
    expect(backend.legacyDeleted).toBe(1);
  });

  it("waits for a running identity load before deleting", async () => {
    const backend = memoryBackend();
    const order: string[] = [];
    const store = createMemoryIdentityStore();
    const slow = {
      ...store,
      addIfAbsent: async (value: Parameters<typeof store.addIfAbsent>[0]) => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("write");
        return store.addIfAbsent(value);
      },
    };
    backend.openIdentityStore = () => slow;
    backend.deleteIdentity = async () => void order.push("delete");
    const data = createAccountData(backend);
    const loading = data.getIdentity("alice");
    await data.deleteUser("alice");
    await loading;
    expect(order).toEqual(["write", "delete"]);
  });
});
