import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testRunBlocker } from "./test-run-readiness";

const ready = {
  health: "online",
  selectedDevice: "phone-1",
  devices: [{ serial: "phone-1", booted: true }],
  stepCount: 2,
  invalidCount: 0,
};

describe("testRunBlocker", () => {
  it("allows a complete test on a ready target", () => {
    assert.equal(testRunBlocker(ready), "");
  });

  it("prioritizes the environmental blocker", () => {
    assert.equal(
      testRunBlocker({ ...ready, health: "offline", invalidCount: 2 }),
      "Start the Relay server before running this test.",
    );
  });

  it("uses human singular and plural copy", () => {
    assert.equal(testRunBlocker({ ...ready, invalidCount: 1 }), "Complete 1 unfinished step.");
    assert.equal(testRunBlocker({ ...ready, invalidCount: 2 }), "Complete 2 unfinished steps.");
  });
});
