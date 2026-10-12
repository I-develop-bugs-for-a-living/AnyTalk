import { DisconnectReason } from "livekit-client";
import { describe, expect, it } from "vitest";

import {
  allowMicRestart,
  isPermanentJoinError,
  REJOIN_GIVE_UP_MS,
  rejoinDelayMs,
  sdkRetryDelayMs,
  shouldKeepRejoining,
  shouldRejoin,
} from "./reconnect";

describe("sdkRetryDelayMs", () => {
  it("retries every 2 to 5 seconds", () => {
    expect(sdkRetryDelayMs({ elapsedMs: 0 }, () => 0)).toBe(2000);
    expect(
      sdkRetryDelayMs({ elapsedMs: 10_000 }, () => 0.999),
    ).toBeLessThanOrEqual(5000);
  });

  it("stops after a minute", () => {
    expect(sdkRetryDelayMs({ elapsedMs: 59_999 })).not.toBeNull();
    expect(sdkRetryDelayMs({ elapsedMs: 60_000 })).toBeNull();
  });
});

describe("rejoinDelayMs", () => {
  it("doubles from one second up to 15 seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(rejoinDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000, 15000,
    ]);
  });
});

describe("shouldKeepRejoining", () => {
  it("gives up after about two minutes", () => {
    expect(shouldKeepRejoining(0)).toBe(true);
    expect(shouldKeepRejoining(REJOIN_GIVE_UP_MS)).toBe(false);
  });
});

describe("shouldRejoin", () => {
  it("rejoins after drops", () => {
    expect(shouldRejoin(undefined)).toBe(true);
    expect(shouldRejoin(DisconnectReason.UNKNOWN_REASON)).toBe(true);
    expect(shouldRejoin(DisconnectReason.SERVER_SHUTDOWN)).toBe(true);
    expect(shouldRejoin(DisconnectReason.SIGNAL_CLOSE)).toBe(true);
  });

  it("does not rejoin when we left or were sent away", () => {
    expect(shouldRejoin(DisconnectReason.CLIENT_INITIATED)).toBe(false);
    expect(shouldRejoin(DisconnectReason.DUPLICATE_IDENTITY)).toBe(false);
    expect(shouldRejoin(DisconnectReason.PARTICIPANT_REMOVED)).toBe(false);
    expect(shouldRejoin(DisconnectReason.ROOM_DELETED)).toBe(false);
    expect(shouldRejoin(DisconnectReason.ROOM_CLOSED)).toBe(false);
    expect(shouldRejoin(DisconnectReason.USER_UNAVAILABLE)).toBe(false);
  });
});

describe("allowMicRestart", () => {
  it("allows three restarts per half minute", () => {
    let list: number[] | undefined = [];
    for (const at of [0, 1000, 2000]) {
      list = allowMicRestart(list!, at);
      expect(list).toBeDefined();
    }
    expect(allowMicRestart(list!, 3000)).toBeUndefined();
    expect(allowMicRestart(list!, 31_000)).toEqual([2000, 31_000]);
  });
});

describe("isPermanentJoinError", () => {
  it("gives up on errors that repeat", () => {
    expect(isPermanentJoinError('{"type":"NoPermission"}')).toBe(true);
    expect(isPermanentJoinError('{"type":"NotFound"}')).toBe(true);
  });

  it("keeps trying on network and server errors", () => {
    expect(isPermanentJoinError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPermanentJoinError('{"type":"InternalError"}')).toBe(false);
    expect(isPermanentJoinError('{"type":"SomethingNew"}')).toBe(false);
    expect(isPermanentJoinError("<html>502 Bad Gateway</html>")).toBe(false);
  });
});
