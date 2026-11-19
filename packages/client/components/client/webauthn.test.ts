import { describe, expect, it } from "vitest";

import {
  base64urlToBytes,
  bytesToBase64url,
  isPromptCancelled,
  manualCreationOptions,
  manualCredentialToJson,
  manualRequestOptions,
} from "./webauthn";

describe("base64url", () => {
  it("round-trips bytes including characters that differ from base64", () => {
    const bytes = new Uint8Array([251, 255, 190, 0, 1, 2]);
    const text = bytesToBase64url(bytes);
    expect(text).toBe("-_--AAEC");
    expect(Array.from(base64urlToBytes(text))).toEqual(Array.from(bytes));
  });

  it("accepts padded input and drops padding on output", () => {
    expect(Array.from(base64urlToBytes("AQI="))).toEqual([1, 2]);
    expect(bytesToBase64url(new Uint8Array([1, 2]))).toBe("AQI");
  });
});

describe("manual options", () => {
  it("decodes the challenge and allowed credential ids", () => {
    const options = manualRequestOptions({
      publicKey: {
        challenge: "AQID",
        rpId: "example.com",
        allowCredentials: [{ type: "public-key", id: "BAUG" }],
      },
    });
    expect(
      Array.from(new Uint8Array(options.challenge as ArrayBuffer)),
    ).toEqual([1, 2, 3]);
    expect(options.rpId).toBe("example.com");
    expect(
      Array.from(
        new Uint8Array(options.allowCredentials![0].id as ArrayBuffer),
      ),
    ).toEqual([4, 5, 6]);
  });

  it("leaves allowCredentials out when the server sent none", () => {
    const options = manualRequestOptions({ publicKey: { challenge: "AQ" } });
    expect("allowCredentials" in options).toBe(false);
  });

  it("decodes the user id and excluded credentials when creating", () => {
    const options = manualCreationOptions({
      publicKey: {
        challenge: "AQID",
        user: { id: "BAUG", name: "a", displayName: "a" },
        excludeCredentials: [{ type: "public-key", id: "BwgJ" }],
      },
    });
    expect(Array.from(new Uint8Array(options.user.id as ArrayBuffer))).toEqual([
      4, 5, 6,
    ]);
    expect(options.user.name).toBe("a");
    expect(
      Array.from(
        new Uint8Array(options.excludeCredentials![0].id as ArrayBuffer),
      ),
    ).toEqual([7, 8, 9]);
  });
});

describe("manualCredentialToJson", () => {
  const buffer = (...bytes: number[]) => new Uint8Array(bytes).buffer;

  it("encodes a sign-in credential and keeps the user handle", () => {
    const json = manualCredentialToJson({
      id: "AQ",
      rawId: buffer(1),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: buffer(1, 2),
        authenticatorData: buffer(3),
        signature: buffer(4),
        userHandle: buffer(5),
      },
    } as unknown as PublicKeyCredential);

    expect(json).toMatchObject({
      id: "AQ",
      rawId: "AQ",
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: "AQI",
        authenticatorData: "Aw",
        signature: "BA",
        userHandle: "BQ",
      },
    });
  });

  it("encodes a registration credential with transports", () => {
    const json = manualCredentialToJson({
      id: "AQ",
      rawId: buffer(1),
      type: "public-key",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: buffer(1),
        attestationObject: buffer(2),
        getTransports: () => ["internal"],
      },
    } as unknown as PublicKeyCredential);

    expect(json.response).toEqual({
      clientDataJSON: "AQ",
      attestationObject: "Ag",
      transports: ["internal"],
    });
  });
});

describe("isPromptCancelled", () => {
  it("treats dismissed prompts as cancelled", () => {
    expect(isPromptCancelled({ name: "NotAllowedError" })).toBe(true);
    expect(isPromptCancelled({ name: "AbortError" })).toBe(true);
  });

  it("does not hide real errors", () => {
    expect(isPromptCancelled({ name: "SecurityError" })).toBe(false);
    expect(isPromptCancelled(undefined)).toBe(false);
  });
});
