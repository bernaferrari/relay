import assert from "node:assert/strict";
import test from "node:test";
import { projectRecordingCompile } from "./recording-compile-projection";

test("recording compile projection groups rapid actions into readable sentences with confidence", () => {
  const projection = projectRecordingCompile([
    {
      id: "tap",
      startedAt: 100,
      finishedAt: 120,
      steps: [{ id: "tap-step", kind: "tap", target: { label: "Continue" } }],
      proof: { status: "verified", outcome: "passed", transition: "changed" },
    },
    {
      id: "type",
      startedAt: 150,
      finishedAt: 190,
      steps: [{ id: "type-step", kind: "type", text: "hello", mode: "append" }],
      proof: { status: "pixels-only" },
    },
  ]);

  assert.equal(projection.status, "partial");
  assert.equal(projection.actionCount, 2);
  assert.equal(projection.proposedStepCount, 2);
  assert.equal(projection.groups.length, 1);
  assert.match(projection.groups[0]?.title ?? "", /2 actions/);
  assert.deepEqual(
    projection.groups[0]?.steps.map((step) => [step.sentence, step.confidence]),
    [
      ['Tap "Continue"', "high"],
      ['Type "hello"', "medium"],
    ],
  );
  assert.deepEqual(projection.feedback, [
    {
      actionId: "type",
      stepId: "type-step",
      severity: "warning",
      message: "Pixels were captured, but semantic endpoint proof is still missing.",
    },
  ]);
});

test("recording compile projection retains partial output and actionable invalid-step feedback", () => {
  const projection = projectRecordingCompile([
    { id: "invalid", steps: [{ id: "tap-step", kind: "tap", target: {} }] },
    { id: "valid", steps: [{ id: "wait-step", kind: "sleep", ms: 10 }] },
  ]);

  assert.equal(projection.status, "partial");
  assert.equal(projection.groups.length, 2);
  assert.equal(projection.groups[0]?.steps[0]?.status, "failed");
  assert.deepEqual(projection.feedback[0], {
    actionId: "invalid",
    stepId: "tap-step",
    severity: "error",
    message: "Needs a target — a label, ref, text, or point.",
  });
  assert.equal(projection.groups[1]?.steps[0]?.sentence, "Wait 10ms");
});

test("empty recording is blocked without throwing away the source", () => {
  assert.deepEqual(projectRecordingCompile([]), {
    status: "blocked",
    actionCount: 0,
    proposedStepCount: 0,
    groups: [],
    feedback: [],
  });
});
