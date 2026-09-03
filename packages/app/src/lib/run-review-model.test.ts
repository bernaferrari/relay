import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo, TraceStep } from "./api-types";
import {
  formatReviewTime,
  initialRunReviewStep,
  runCompletion,
  runElapsedAtStep,
  runReviewCounts,
  runTimelineWeights,
} from "./run-review-model";

const step = (durationMs: number, status = "ok"): TraceStep => ({
  id: String(durationMs),
  index: 0,
  kind: "tap",
  tone: status === "error" ? "danger" : "neutral",
  title: "Step",
  glyphs: [],
  startedAt: 0,
  durationMs,
  frames: [],
  log: "",
  status,
});

const job = (steps: TraceStep[]): JobInfo => ({
  id: "run",
  action: "test",
  status: "error",
  queuedAt: 0,
  logs: ["one", "two"],
  steps,
  artifacts: [
    { kind: "network", capturedAt: 0, data: {} },
    { kind: "semantic-evaluation", capturedAt: 0, data: {} },
  ],
});

test("run review opens at the failed step", () => {
  assert.equal(initialRunReviewStep(job([step(200), step(300, "error"), step(400)])), 1);
  assert.equal(initialRunReviewStep(job([step(200), step(300)])), 0);
  assert.equal(initialRunReviewStep({ ...job([step(200), step(300)]), status: "ok" }), 1);
});

test("review counts and completion stay compact", () => {
  assert.deepEqual(runReviewCounts(job([step(200)])), { checks: 1, network: 1, logs: 2 });
  assert.deepEqual(runCompletion(job([step(200), step(300)]), 4), {
    observed: 2,
    total: 4,
    percent: 50,
  });
});

test("timeline weights reflect duration while keeping every step targetable", () => {
  const weights = runTimelineWeights([step(10), step(20_000)], 3);
  assert.equal(weights.length, 3);
  assert.ok(weights[0]! > 0);
  assert.ok(weights[1]! < 0.9);
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 0.0001);
});

test("elapsed time and labels are human readable", () => {
  assert.equal(runElapsedAtStep([step(250), step(1_500)], 2), 1_750);
  assert.equal(formatReviewTime(240), "240ms");
  assert.equal(formatReviewTime(1_250), "1.3s");
});
