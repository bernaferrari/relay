import assert from "node:assert/strict";
import test from "node:test";
import { isTargetUnavailableError } from "./target-unavailable.js";

test("recognizes explicit target loss without confusing missing UI selectors", () => {
  assert.equal(
    isTargetUnavailableError(
      new Error(
        "Command failed: adb -s RQCY104BG8X exec-out screencap -p\n" +
          "error: device 'RQCY104BG8X' not found\n",
      ),
    ),
    true,
  );
  assert.equal(isTargetUnavailableError(new Error("device 'pixel-1' is offline")), true);
  assert.equal(isTargetUnavailableError(new Error("No Android devices connected")), true);
  assert.equal(isTargetUnavailableError(new Error("Settings row was not found")), false);
  assert.equal(
    isTargetUnavailableError(new Error("expect-screen: on unknown, not Settings")),
    false,
  );
});

test("recognizes target loss wrapped as an error cause", () => {
  assert.equal(
    isTargetUnavailableError(
      new Error("capture failed", { cause: new Error("error: device 'pixel-1' not found") }),
    ),
    true,
  );
});
