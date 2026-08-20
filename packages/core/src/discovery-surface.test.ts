import assert from "node:assert/strict";
import test from "node:test";
import {
  captureFullSurfaceEvidence,
  shouldCaptureFullSurface,
  visitedRowBounds,
} from "./discovery-surface.js";
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";

function unknownIosScroll(): IosMutationOutcomeUnknownError {
  return new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "scroll",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("XCTest transport ended"),
  );
}

test("visited row bounds follow the opened label", () => {
  const rows = visitedRowBounds(
    [
      {
        label: "Connections",
        rect: { x: 12, y: 80, width: 200, height: 40 },
        visibleToUser: true,
      },
      { label: "Home", rect: { x: 0, y: 0, width: 40, height: 40 }, visibleToUser: true },
    ],
    [{ label: "Connections" }],
  );
  assert.deepEqual(rows, [{ bounds: { x: 12, y: 80, width: 200, height: 40 } }]);
});

test("Settings-class lists request a full-page capture", () => {
  assert.equal(shouldCaptureFullSurface("Settings", []), true);
  assert.equal(shouldCaptureFullSurface("Chat", ["private message"]), false);
});

test("does not convert an unknown iOS full-surface scroll into missing evidence", async () => {
  let surveys = 0;
  await assert.rejects(
    captureFullSurfaceEvidence("ios-surface", "Settings", [], {
      captureSurvey: async () => {
        surveys += 1;
        throw unknownIosScroll();
      },
    }),
    IosMutationOutcomeUnknownError,
  );
  assert.equal(surveys, 1);
});
