import assert from "node:assert/strict";
import test from "node:test";
import { UsageError } from "./errors.js";
import { parseOutcomeCliIntent } from "./outcome-command.js";

function tokens(positionals: string[], confirm = false) {
  return {
    positionals,
    values: new Map<string, string>(),
    switches: new Set(confirm ? ["--confirm"] : []),
  };
}

test("CLI inspection uses durable Run and workflow IDs", () => {
  assert.deepEqual(parseOutcomeCliIntent(tokens(["inspect", "workflow-123"])), {
    kind: "inspect",
    runOrWorkflowId: "workflow-123",
  });
  assert.equal(parseOutcomeCliIntent(tokens(["inspect-workflow", "workflow-123"])), undefined);
  assert.throws(
    () => parseOutcomeCliIntent(tokens(["inspect", "relay-workflow.v1.bGVnYWN5"])),
    /saved Run or workflow ID/u,
  );
});

test("CLI cancellation requires confirmation and one numeric CAS version", () => {
  assert.throws(
    () => parseOutcomeCliIntent(tokens(["cancel-run", "workflow-123", "2"])),
    UsageError,
  );
  assert.throws(
    () => parseOutcomeCliIntent(tokens(["cancel-run", "workflow-123", "job-v1-old"], true)),
    UsageError,
  );
  assert.deepEqual(parseOutcomeCliIntent(tokens(["cancel-run", "workflow-123", "2"], true)), {
    kind: "cancel-run",
    workflowId: "workflow-123",
    expectedVersion: 2,
    confirmCancel: true,
  });
});
