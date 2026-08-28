import assert from "node:assert/strict";
import test from "node:test";
import type { RelayOutcomeJobs } from "@relay/workflows";
import { invokeRelayOutcomeToolWithJobs, relayOutcomeTools } from "./outcome-tools.js";

function recordingJobs(calls: Array<{ method: string; input: unknown }>): RelayOutcomeJobs {
  return new Proxy(
    {},
    {
      get(_target, method) {
        return async (input: unknown) => {
          calls.push({ method: String(method), input });
          return { method, input };
        };
      },
    },
  ) as RelayOutcomeJobs;
}

test("default MCP inspects a workflow ID or an explicit legacy v1 input, never an opaque mixed shape", async () => {
  const descriptor = relayOutcomeTools.find(({ name }) => name === "relay_inspect_workflow")!;
  assert.equal(descriptor.inputSchema.safeParse({ workflowId: "workflow-1" }).success, true);
  assert.equal(
    descriptor.inputSchema.safeParse({ legacyRef: "relay-workflow.v1.bGVnYWN5" }).success,
    true,
  );
  assert.equal(
    descriptor.inputSchema.safeParse({ workflowId: "workflow-1", legacyRef: "legacy" }).success,
    false,
  );
  assert.equal(descriptor.inputSchema.safeParse({ ref: "old-untyped-ref" }).success, false);

  const calls: Array<{ method: string; input: unknown }> = [];
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_inspect_workflow",
    argumentsValue: { workflowId: "workflow-1" },
    confirmed: false,
    jobs: recordingJobs(calls),
  });
  assert.deepEqual(calls, [{ method: "inspect", input: { workflowId: "workflow-1" } }]);
});

test("default MCP cancellation carries only workflow ID and exact version after confirmation", async () => {
  const descriptor = relayOutcomeTools.find(({ name }) => name === "relay_cancel_run")!;
  assert.equal(descriptor.requiresConfirmation, true);
  assert.equal(
    descriptor.inputSchema.safeParse({ workflowId: "workflow-1", expectedVersion: 2 }).success,
    true,
  );
  assert.equal(
    descriptor.inputSchema.safeParse({
      workflowId: "workflow-1",
      expectedVersion: "job-v1-old",
    }).success,
    false,
  );

  const calls: Array<{ method: string; input: unknown }> = [];
  await assert.rejects(
    invokeRelayOutcomeToolWithJobs({
      name: "relay_cancel_run",
      argumentsValue: { workflowId: "workflow-1", expectedVersion: 2 },
      confirmed: false,
      jobs: recordingJobs(calls),
    }),
    /requires confirm/u,
  );
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_cancel_run",
    argumentsValue: { workflowId: "workflow-1", expectedVersion: 2 },
    confirmed: true,
    jobs: recordingJobs(calls),
  });
  assert.deepEqual(calls, [
    {
      method: "cancelRun",
      input: {
        kind: "cancel-run",
        workflowId: "workflow-1",
        expectedVersion: 2,
        confirmCancel: true,
      },
    },
  ]);
});
