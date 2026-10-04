import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "./operations.js";

const input = operationDefinition("workflow.transition").input;
const record = {
  workflowId: "workflow-1",
  expectedVersion: 3,
  action: "authoring-record",
  interaction: { kind: "wait", ms: 1 },
};

test("recording transitions preserve a bounded client mutation identity and accept legacy input", () => {
  const parsed = input.parse({ ...record, mutationId: "recording-1" });
  assert.ok(parsed.action === "authoring-record");
  assert.equal(parsed.mutationId, "recording-1");
  assert.doesNotThrow(() => input.parse(record));
  for (const mutationId of ["", " ", "x".repeat(257), 1]) {
    assert.throws(() => input.parse({ ...record, mutationId }));
  }
});

test("a client recording mutation identity is forbidden on other transitions", () => {
  assert.throws(() =>
    input.parse({
      workflowId: "workflow-1",
      expectedVersion: 3,
      action: "authoring-stop",
      mutationId: "recording-1",
    }),
  );
});
