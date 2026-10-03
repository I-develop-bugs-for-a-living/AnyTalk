import { describe, expect, it } from "vitest";

import { tokenRoom } from "./livekitToken";

const jwt = (claims: object) =>
  [
    "eyJhbGciOiJIUzI1NiJ9",
    btoa(JSON.stringify(claims))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, ""),
    "signature",
  ].join(".");

describe("tokenRoom", () => {
  it("reads the room from a LiveKit token", () => {
    expect(
      tokenRoom(
        jwt({ sub: "user", video: { room: "01CHANNEL", roomJoin: true } }),
      ),
    ).toBe("01CHANNEL");
  });

  it("gives nothing for tokens without a room or that aren't JWTs", () => {
    expect(tokenRoom(jwt({ sub: "user" }))).toBeUndefined();
    expect(tokenRoom("not a token")).toBeUndefined();
  });
});
