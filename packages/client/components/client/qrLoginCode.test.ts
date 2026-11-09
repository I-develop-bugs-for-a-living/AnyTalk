import { describe, expect, it } from "vitest";

import {
  checkQrLogin,
  encodeQrLogin,
  isQrLoginId,
  parseQrLogin,
} from "./qrLoginCode";

const ID = "abcdefghijklmnopqrstuvwxyz012345";

describe("qr login code", () => {
  it("round-trips an id", () => {
    const content = encodeQrLogin(ID, "https://chat.example.com");
    expect(content).toBe(`https://chat.example.com/qr-login#${ID}`);
    expect(parseQrLogin(content)).toBe(ID);
  });

  it("accepts ids with dashes and underscores", () => {
    const id = "ABC_def-ghijklmnopqrstuvwxyz0123";
    expect(isQrLoginId(id)).toBe(true);
    expect(parseQrLogin(`http://localhost:5173/qr-login#${id}`)).toBe(id);
  });

  it("rejects bad ids", () => {
    expect(isQrLoginId("short")).toBe(false);
    expect(isQrLoginId(ID + "x")).toBe(false);
    expect(isQrLoginId(ID.slice(1) + "/")).toBe(false);
    expect(parseQrLogin(`https://a.b/qr-login#${ID}x`)).toBeUndefined();
    expect(parseQrLogin("https://a.b/qr-login#")).toBeUndefined();
    expect(parseQrLogin("https://a.b/qr-login")).toBeUndefined();
  });

  it("rejects other content", () => {
    expect(parseQrLogin("")).toBeUndefined();
    expect(parseQrLogin(ID)).toBeUndefined();
    expect(parseQrLogin("otpauth://totp/x?secret=abc")).toBeUndefined();
    expect(parseQrLogin(`javascript:alert(1)//qr-login#${ID}`)).toBeUndefined();
    expect(parseQrLogin(`https://a.b/other#${ID}`)).toBeUndefined();
    expect(parseQrLogin(`https://a.b/qr-login?x=1#${ID}`)).toBeUndefined();
    expect(parseQrLogin(`https://u:p@a.b/qr-login#${ID}`)).toBeUndefined();
  });

  it("tells apart codes from another server", () => {
    const origin = "https://chat.example.com";
    expect(checkQrLogin(`${origin}/qr-login#${ID}`, origin)).toEqual({
      kind: "ok",
      id: ID,
    });
    expect(
      checkQrLogin(`https://other.example/qr-login#${ID}`, origin),
    ).toEqual({ kind: "foreign" });
    expect(checkQrLogin("hello", origin)).toEqual({ kind: "invalid" });
  });
});

describe("qr login code from localhost", () => {
  it("flags a localhost code scanned on another address", () => {
    const content = encodeQrLogin(ID, "https://localhost:5175");
    expect(checkQrLogin(content, "https://192.168.178.26:5175")).toEqual({
      kind: "local",
    });
  });

  it("still treats another real host as foreign", () => {
    const content = encodeQrLogin(ID, "https://other.example.com");
    expect(checkQrLogin(content, "https://192.168.178.26:5175")).toEqual({
      kind: "foreign",
    });
  });
});
