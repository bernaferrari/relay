import assert from "node:assert/strict";
import { test } from "node:test";
import { finishCheckedStep } from "./session-trace-steps.js";
import type { TraceStep } from "./trace.js";

for (const status of ["failed", "blocked", "deferred", "cancelled", "passed"]) {
  test(`returned campaign ${status} is reflected in its trace`, () => {
    const step = { startedAt: Date.now(), status: "running", log: "" } as TraceStep;
    finishCheckedStep(step, "network", [
      { kind: "campaign-check-result", data: { id: "network", status } },
    ]);
    assert.equal(step.status, status === "passed" ? "ok" : "error");
  });
}

test("nested or earlier checks do not overwrite the current successful check", () => {
  const step = { startedAt: Date.now(), log: "" } as TraceStep;
  finishCheckedStep(step, "network", [
    { kind: "campaign-check-result", data: { id: "network", status: "failed" } },
    { kind: "campaign-check-result", data: { id: "other", status: "failed" } },
    { kind: "campaign-check-result", data: { id: "network", status: "passed" } },
  ]);
  assert.equal(step.status, "ok");
});
