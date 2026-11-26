import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "../operations.js";

const input = {
  appMapId: "grok-ios",
  target: { kind: "device" as const, platform: "ios" as const, targetId: "iPad" },
  leaseId: "recording-lease",
  expectedAppMapRevision: 399,
  pendingConnectionId: "fast-menu",
};

for (const operation of ["authoring.session.create", "authoring.session.begin"] as const) {
  test(`${operation} accepts the explicit recording application through the canonical contract`, () => {
    const contract = operationDefinition(operation).input;
    const explicit = { ...input, originApplication: "ai.x.GrokApp" };
    assert.deepEqual(contract.parse(explicit), explicit);
    assert.deepEqual(contract.presentation.parse(explicit), explicit);
    assert.deepEqual(contract.parse(input), input, "legacy callers may omit the application");
    for (const originApplication of ["", "   ", 1, null]) {
      const invalid = { ...input, originApplication };
      assert.throws(() => contract.parse(invalid));
      assert.throws(() => contract.presentation.parse(invalid));
    }
  });
}

test("create and begin preserve workflow and debug provenance admission", () => {
  const debugOrigin = {
    schemaVersion: 1 as const,
    source: { runId: "run-1", attempt: 1, stepId: "step-1" },
    evidenceRefs: ["evidence-1"],
    configRefs: ["config-1"],
  };
  for (const operation of ["authoring.session.create", "authoring.session.begin"] as const) {
    const contract = operationDefinition(operation).input;
    const valid = { ...input, workflowRequestId: "workflow-1", debugOrigin };
    assert.deepEqual(contract.parse(valid), valid);
    const invalidAttempt = {
      ...valid,
      debugOrigin: { ...debugOrigin, source: { ...debugOrigin.source, attempt: 0 } },
    };
    assert.throws(() => contract.parse(invalidAttempt), /attempt/u);
  }
});
