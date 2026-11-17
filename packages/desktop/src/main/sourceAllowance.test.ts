import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { grantAllowance, takeAllowance } from "./sourceAllowance.ts";

describe("takeAllowance", () => {
  const granted = grantAllowance("window:1:0", 1000, 500);

  it("grants a matching id once", () => {
    const first = takeAllowance(granted, 1100, "window:1:0");
    assert.equal(first.granted, "window:1:0");
    const second = takeAllowance(first.next, 1100, "window:1:0");
    assert.equal(second.granted, undefined);
  });

  it("grants whichever id when none is asked for", () => {
    assert.equal(takeAllowance(granted, 1100).granted, "window:1:0");
  });

  it("refuses another id and keeps the allowance", () => {
    const result = takeAllowance(granted, 1100, "screen:0:0");
    assert.equal(result.granted, undefined);
    assert.equal(result.next, granted);
  });

  it("refuses at the expiry time and after", () => {
    assert.equal(
      takeAllowance(granted, 1499, "window:1:0").granted,
      "window:1:0",
    );
    assert.equal(takeAllowance(granted, 1500, "window:1:0").granted, undefined);
    assert.equal(takeAllowance(granted, 2000).next, undefined);
  });

  it("refuses without an allowance", () => {
    assert.equal(takeAllowance(undefined, 0, "window:1:0").granted, undefined);
  });
});
