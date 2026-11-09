import { describe, expect, it } from "vitest";

import {
  b64uDecode,
  b64uEncode,
  generateCallKeyPair,
  generateIdentity,
  generateMediaKey,
  identityFingerprint,
  loadOrCreateIdentity,
  signHello,
  unwrapMediaKey,
  verifyHello,
  wrapMediaKey,
} from "./crypto";
import { createMemoryIdentityStore } from "./identityStore";

const ctx = { callId: "call1", from: "alice", to: "bob", keyIndex: 3 };

describe("base64url", () => {
  it("round trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 251, 252, 253, 254, 255, 1]);
    expect(b64uDecode(b64uEncode(bytes))).toEqual(bytes);
    expect(b64uEncode(bytes)).not.toMatch(/[+/=]/);
  });
  it("rejects malformed and non-canonical input", () => {
    expect(() => b64uDecode("a+b")).toThrow();
    // "AB" has non-zero trailing bits; canonical form of the same byte is "AA"
    expect(() => b64uDecode("AB")).toThrow();
    expect(b64uDecode("AA")).toEqual(new Uint8Array([0]));
  });
});

describe("key pairs", () => {
  it("exports a 65 byte public key and keeps the private key hidden", async () => {
    const pair = await generateCallKeyPair();
    expect(pair.publicRaw.length).toBe(65);
    expect(pair.privateKey.extractable).toBe(false);
  });
  it("generates 128 bit random media keys", () => {
    const a = generateMediaKey();
    expect(a.length).toBe(16);
    expect(a).not.toEqual(generateMediaKey());
  });
});

describe("key wrapping", () => {
  it("round trips", async () => {
    const a = await generateCallKeyPair();
    const b = await generateCallKeyPair();
    const key = generateMediaKey();
    const wrapped = await wrapMediaKey(a.privateKey, b.publicRaw, ctx, key);
    const out = await unwrapMediaKey(b.privateKey, a.publicRaw, ctx, wrapped);
    expect(out).toEqual(key);
  });
  it("fails for a different recipient, sender, index or call", async () => {
    const a = await generateCallKeyPair();
    const b = await generateCallKeyPair();
    const c = await generateCallKeyPair();
    const wrapped = await wrapMediaKey(
      a.privateKey,
      b.publicRaw,
      ctx,
      generateMediaKey(),
    );
    const bad = [
      { ...ctx, to: "carol" },
      { ...ctx, from: "mallory" },
      { ...ctx, keyIndex: 4 },
      { ...ctx, callId: "call2" },
    ];
    for (const context of bad) {
      await expect(
        unwrapMediaKey(b.privateKey, a.publicRaw, context, wrapped),
      ).rejects.toThrow();
    }
    await expect(
      unwrapMediaKey(c.privateKey, a.publicRaw, ctx, wrapped),
    ).rejects.toThrow();
  });
  it("fails for tampered ciphertext", async () => {
    const a = await generateCallKeyPair();
    const b = await generateCallKeyPair();
    const wrapped = await wrapMediaKey(
      a.privateKey,
      b.publicRaw,
      ctx,
      generateMediaKey(),
    );
    wrapped.ciphertext[0] ^= 1;
    await expect(
      unwrapMediaKey(b.privateKey, a.publicRaw, ctx, wrapped),
    ).rejects.toThrow();
  });
});

describe("hello signatures", () => {
  it("verifies and binds call, user and call key", async () => {
    const id = await generateIdentity();
    const call = await generateCallKeyPair();
    const other = await generateCallKeyPair();
    const sig = await signHello(id.privateKey, "c", "alice", call.publicRaw);
    expect(
      await verifyHello(id.publicRaw, "c", "alice", call.publicRaw, sig),
    ).toBe(true);
    expect(
      await verifyHello(id.publicRaw, "x", "alice", call.publicRaw, sig),
    ).toBe(false);
    expect(
      await verifyHello(id.publicRaw, "c", "bob", call.publicRaw, sig),
    ).toBe(false);
    expect(
      await verifyHello(id.publicRaw, "c", "alice", other.publicRaw, sig),
    ).toBe(false);
    const stranger = await generateIdentity();
    expect(
      await verifyHello(stranger.publicRaw, "c", "alice", call.publicRaw, sig),
    ).toBe(false);
    expect(
      await verifyHello(new Uint8Array(3), "c", "alice", call.publicRaw, sig),
    ).toBe(false);
  });
});

describe("identity", () => {
  it("fingerprints are stable and distinct", async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    expect(await identityFingerprint(a.publicRaw)).toBe(
      await identityFingerprint(a.publicRaw),
    );
    expect(await identityFingerprint(a.publicRaw)).not.toBe(
      await identityFingerprint(b.publicRaw),
    );
  });
  it("loadOrCreateIdentity reuses the stored identity", async () => {
    const store = createMemoryIdentityStore();
    const first = await loadOrCreateIdentity(store);
    const second = await loadOrCreateIdentity(store);
    expect(second.publicRaw).toEqual(first.publicRaw);
  });
  it("never overwrites the store when it cannot be read", async () => {
    let saved = 0;
    const store = {
      load: async () => {
        throw new Error("idb broken");
      },
      addIfAbsent: async () => {
        saved++;
        return true;
      },
    };
    const first = await loadOrCreateIdentity(store);
    const second = await loadOrCreateIdentity(store);
    expect(saved).toBe(0);
    expect(second.publicRaw).toEqual(first.publicRaw);
  });

  it("uses the identity another tab created first", async () => {
    const winner = await generateIdentity();
    let loads = 0;
    const store = {
      load: async () => (loads++ === 0 ? undefined : winner),
      addIfAbsent: async () => false,
    };
    const out = await loadOrCreateIdentity(store);
    expect(out.publicRaw).toEqual(winner.publicRaw);
  });

  it("rejects invalid stored records without overwriting", async () => {
    let saved = 0;
    const store = {
      load: async () =>
        ({ privateKey: {}, publicRaw: new Uint8Array(3) }) as never,
      addIfAbsent: async () => {
        saved++;
        return true;
      },
    };
    const out = await loadOrCreateIdentity(store);
    expect(out.publicRaw.length).toBe(65);
    expect(saved).toBe(0);
  });
});
