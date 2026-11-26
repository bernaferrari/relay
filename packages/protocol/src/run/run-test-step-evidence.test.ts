import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOptionalRunTestStepEvidence,
  parseRunTestStepEvidence,
} from "./run-test-step-evidence.js";

const valid = {
  schemaVersion: 1,
  testStepId: "authored-step",
  recipeId: "root",
  recipeStepId: "recipe-step",
  traceStepId: "trace-uuid",
  traceStepIndex: 0,
  occurrence: 1,
  evidence: {
    framePaths: ["frames/001.png"],
    eventSequences: [4],
    artifactKinds: ["ui-tree"],
  },
} as const;

test("Run test-step evidence has a strict, stable authored-step contract", () => {
  assert.deepEqual(parseRunTestStepEvidence(valid), valid);
  assert.throws(() => parseRunTestStepEvidence({ ...valid, traceStepId: "" }), /too_small/u);
  assert.equal(parseOptionalRunTestStepEvidence(undefined), undefined);
  assert.equal(parseOptionalRunTestStepEvidence({}), undefined);
  assert.equal(parseOptionalRunTestStepEvidence([{ ...valid, extra: true }]), undefined);
});
