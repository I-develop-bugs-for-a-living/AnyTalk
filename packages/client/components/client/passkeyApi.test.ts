import { describe, expect, it } from "vitest";

import {
  PasskeyApiError,
  allowsWebAuthn,
  defaultPasskeyName,
  isUnsupportedByServer,
} from "./passkeyApi";

describe("defaultPasskeyName", () => {
  const key = (name: string) => ({ id: name, name, created_at: "" });

  it("uses the base name when free", () => {
    expect(defaultPasskeyName([], "Passkey")).toBe("Passkey");
  });

  it("numbers the name when taken", () => {
    expect(defaultPasskeyName([key("Passkey")], "Passkey")).toBe("Passkey 2");
    expect(
      defaultPasskeyName([key("Passkey"), key("Passkey 2")], "Passkey"),
    ).toBe("Passkey 3");
  });
});

describe("allowsWebAuthn", () => {
  it("finds the method", () => {
    expect(allowsWebAuthn(["Totp", "WebAuthn"])).toBe(true);
    expect(allowsWebAuthn(["Totp"])).toBe(false);
    expect(allowsWebAuthn(undefined)).toBe(false);
  });
});

describe("isUnsupportedByServer", () => {
  it("is true for missing routes only", () => {
    expect(isUnsupportedByServer(new PasskeyApiError(404))).toBe(true);
    expect(isUnsupportedByServer(new PasskeyApiError(401))).toBe(false);
    expect(isUnsupportedByServer(new Error("x"))).toBe(false);
  });
});
