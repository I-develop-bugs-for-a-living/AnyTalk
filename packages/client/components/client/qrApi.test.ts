import { describe, expect, it } from "vitest";

import { qrApproveOptions, shouldDenyOnClose } from "./qrApi";

describe("shouldDenyOnClose", () => {
  it("denies a request that was dismissed unanswered", () => {
    expect(shouldDenyOnClose(false, false)).toBe(true);
  });

  it("does not deny after an answer", () => {
    expect(shouldDenyOnClose(true, false)).toBe(false);
  });

  it("does not deny a request that is gone", () => {
    expect(shouldDenyOnClose(false, true)).toBe(false);
  });
});

describe("qrApproveOptions", () => {
  it("prefers allowed_methods", () => {
    expect(
      qrApproveOptions({
        method: "password",
        allowed_methods: ["Totp", "WebAuthn", "Recovery"],
      }),
    ).toEqual({ password: false, totp: true, recovery: true, passkey: true });
  });

  it("falls back to the old method field", () => {
    expect(qrApproveOptions({ method: "password" })).toEqual({
      password: true,
      totp: false,
      recovery: false,
      passkey: false,
    });
    expect(qrApproveOptions({ method: "totp_or_recovery" })).toMatchObject({
      totp: true,
      recovery: true,
    });
  });
});
