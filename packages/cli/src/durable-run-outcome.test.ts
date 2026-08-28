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

test("CLI inspects durable Run IDs and recognizes bounded legacy v1 reads", () => {
  assert.deepEqual(parseOutcomeCliIntent(tokens(["inspect-workflow", "workflow-123"])), {
    kind: "inspect-workflow",
    workflowId: "workflow-123",
  });
  assert.deepEqual(
    parseOutcomeCliIntent(tokens(["inspect-workflow", "relay-workflow.v1.bGVnYWN5"])),
    {
      kind: "inspect-workflow",
      legacyRef: "relay-workflow.v1.bGVnYWN5",
    },
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
