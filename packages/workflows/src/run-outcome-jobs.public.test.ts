import assert from "node:assert/strict";
import test from "node:test";
import type { DurableWorkflowRead, TargetPreflight } from "@relay/protocol";
import { createRelayRunOutcomeJobs } from "./run-outcome-jobs.js";
import { createScriptedRelayClient } from "./testing.js";

const browser = {
  id: "browser-checkout",
  serial: "browser-checkout",
  name: "Checkout browser",
  kind: "managed-browser",
  booted: true,
  platform: "browser" as const,
};

const browserDefinition = {
  id: "browser-checkout",
  name: "Checkout browser",
  kind: "browser" as const,
  createdAt: 1,
  updatedAt: 1,
  browser: { startUrl: "https://example.test/checkout", headless: true },
};

const readyPreflight: TargetPreflight = {
  targetId: "browser-checkout",
  ok: true,
  checkedAt: 1,
  capabilities: ["snapshot", "screenshot", "recording", "tap", "type", "scroll"],
  checks: [
    { id: "executable", label: "Browser executable", status: "pass", message: "Chrome" },
    { id: "profile", label: "Isolated profile", status: "pass", message: "Writable" },
  ],
};

const frozen = {
  appMapId: "app-1",
  appMapRevision: 7,
  testId: "test-1",
  planDigest: "plan-7",
  target: { kind: "browser" as const, platform: "browser" as const, targetId: browser.id },
  rootRecipeId: "root",
};

function workflow(
  version: number,
  status: DurableWorkflowRead["record"]["status"] = "active",
): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: "workflow-1",
      organizationId: "local",
      projectId: "default",
      kind: "run-test",
      version,
      status,
      frozenIdentity: frozen,
      resource: { kind: "job", id: "job-1" },
      createdBy: "agent:test",
      lastActorId: "agent:test",
      createdAt: 1,
      updatedAt: version,
      expiresAt: 100_000,
      lastTransition: status === "terminal" ? "run-cancelled" : "run-attached",
    },
    audit: [],
  };
}

test("run refuses a managed browser until canonical preflight passes", async () => {
  const scripted = createScriptedRelayClient([
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    { id: "target.devices.list", output: { devices: [browser] } },
    { id: "target.list", output: { targets: [browserDefinition] } },
    {
      id: "target.preflight",
      output: {
        preflight: {
          ...readyPreflight,
          ok: false,
          checks: [
            {
              id: "navigation",
              label: "Start page",
              status: "fail",
              message: "The start page could not be reached",
            },
          ],
        },
      },
    },
  ]);
  const jobs = createRelayRunOutcomeJobs(scripted.client, { actorId: "agent:test" });

  await assert.rejects(
    jobs.run({ kind: "run-test", appMapId: "app-1", testId: "test-1" }),
    /managed browser target is not ready|No connected.*ready/u,
  );
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.get", "target.devices.list", "target.list", "target.preflight"],
  );
});

test("cancel requires consent and forwards the latest durable CAS version", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "workflow-1",
          expectedVersion: 4,
          action: "cancel-run",
        }),
      output: {
        workflow: workflow(5, "terminal"),
        job: { id: "job-1", action: "app-map.test.run", status: "cancelled", queuedAt: 1 },
      },
    },
  ]);
  const jobs = createRelayRunOutcomeJobs(scripted.client, { actorId: "agent:test" });

  await assert.rejects(
    jobs.cancelRun({
      kind: "cancel-run",
      workflowId: "workflow-1",
      expectedVersion: 4,
      confirmCancel: undefined as never,
    }),
    /explicit confirmation/u,
  );
  assert.equal(scripted.invocations.length, 0);

  const cancelled = await jobs.cancelRun({
    kind: "cancel-run",
    workflowId: "workflow-1",
    expectedVersion: 4,
    confirmCancel: true,
  });
  assert.equal(cancelled.phase, "cancelled");
  assert.deepEqual(cancelled.workflow, { workflowId: "workflow-1", expectedVersion: 5 });
});

test("inspect returns only the canonical Run projection", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "workflow.get",
      output: {
        workflow: workflow(3),
        job: { id: "job-1", action: "app-map.test.run", status: "running", queuedAt: 1 },
      },
    },
  ]);
  const jobs = createRelayRunOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const inspected = await jobs.inspect({ workflowId: "workflow-1" });
  assert.equal(inspected.kind, "run-test");
  assert.equal(inspected.phase, "running");
  assert.deepEqual(inspected.workflow, { workflowId: "workflow-1", expectedVersion: 3 });
  assert.equal("ref" in inspected, false);
});
