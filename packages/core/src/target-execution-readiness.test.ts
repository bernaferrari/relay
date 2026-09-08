import assert from "node:assert/strict";
import test from "node:test";
import type { TargetRuntimeReadiness } from "@relay/protocol";
import { targetExecutionReadiness } from "./target-execution-readiness.js";

function readiness(reason: "input-changed" | "visual-changed"): TargetRuntimeReadiness {
  return {
    previewPixels: {
      mode: "pixels",
      state: "unproven",
      freshness: "unproven",
      reason: "not-yet-proven",
    },
    evidenceCapture: {
      mode: "evidence",
      state: "unproven",
      freshness: "unproven",
      reason: "not-yet-proven",
    },
    semanticControl: {
      mode: "accessibility",
      state: "proven",
      freshness: "stale",
      proof: { at: 1 },
      invalidated: { at: 2, reason },
    },
  };
}
for (const reason of ["input-changed", "visual-changed"] as const) {
  test(`normal ${reason} keeps a connected device selectable`, () => {
    assert.deepEqual(
      targetExecutionReadiness({
        platform: "android",
        connectionState: "connected",
        booted: true,
        readiness: readiness(reason),
      }),
      { runnable: true },
    );
  });
}
test("ordinary screen invalidation does not override a disconnected device", () => {
  const result = targetExecutionReadiness({
    platform: "android",
    connectionState: "offline",
    readiness: readiness("input-changed"),
  });
  assert.equal(result.runnable, false);
});
test("unexplained stale observation still requires recovery", () => {
  const state = readiness("input-changed");
  delete state.semanticControl.invalidated;
  const result = targetExecutionReadiness({ platform: "android", readiness: state });
  assert.equal(result.runnable, false);
});
