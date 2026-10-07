import assert from "node:assert/strict";
import test from "node:test";
import type { DurableWorkflowRead, TargetPreflight } from "@relay/protocol";
import { createRelayRunOutcomeJobs } from "./run-outcome-jobs.js";
import { createRelayOutcomeJobs } from "./outcome-jobs.js";
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

test("public run entrypoint forwards cold startup into compilation", async () => {
  const scripted = createScriptedRelayClient([
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    { id: "target.devices.list", output: { devices: [browser] } },
    { id: "target.list", output: { targets: [browserDefinition] } },
    { id: "target.preflight", output: { preflight: readyPreflight } },
    {
      id: "app-map.test.compile",
      checkInput: (input) => assert.equal((input as { startupMode?: string }).startupMode, "cold"),
      output: {
        plan: { rootRecipeId: "root", startup: { mode: "cold" } },
        preflight: {
          schemaVersion: 1,
          mode: "offline-test-preflight",
          appMapId: "app-1",
          appMapRevision: 7,
          testId: "test-1",
          planDigest: "plan-7",
          executionRisk: {
            schemaVersion: 1,
            level: "safe",
            reasons: [],
            externalEffects: [],
            confirmation: "none",
            expectedAppBoundaries: [],
            maximumActions: 0,
            maximumDurationMs: 0,
            cleanupRequired: false,
          },
          summary: {
            recipes: 1,
            checkedSelectors: 0,
            resolvedSelectors: 0,
            unknownCursorTransitions: 0,
            reviewRequiredReturns: 0,
            blockers: 1,
            warnings: 0,
          },
          selectors: [],
          cursorTimeline: [],
          returns: [],
          findings: [
            { severity: "blocker", recipeId: "root", code: "missing", message: "blocked" },
          ],
        },
      },
    },
  ]);
  const jobs = createRelayRunOutcomeJobs(scripted.client, { actorId: "agent:test" });
  const result = await jobs.run({
    kind: "run-test",
    appMapId: "app-1",
    testId: "test-1",
    targetId: browser.id,
    startup: { mode: "cold" },
  });
  assert.equal(result.phase, "blocked");
});

test("both public Run entrypoints carry runtime prompts to canonical Test admission", async () => {
  const variables = { chat_prompt: "Prompt C", token: "private runtime input" };
  const native = {
    id: "native-fixture",
    serial: "native-fixture",
    name: "Native fixture",
    booted: true,
    platform: "android" as const,
  };
  const reserved = workflow(1);
  const { resource: _resource, ...unstarted } = reserved.record;
  for (const createJobs of [createRelayRunOutcomeJobs, createRelayOutcomeJobs]) {
    const scripted = createScriptedRelayClient([
      { id: "app-map.get", output: { appMap: { revision: 7 } } },
      { id: "target.devices.list", output: { devices: [native] } },
      { id: "app-map.get", output: { appMap: { revision: 7 } } },
      {
        id: "app-map.test.compile",
        output: {
          plan: { rootRecipeId: "root" },
          preflight: {
            schemaVersion: 1,
            mode: "offline-test-preflight",
            appMapId: "app-1",
            appMapRevision: 7,
            testId: "test-1",
            planDigest: "plan-7",
            executionRisk: {
              schemaVersion: 1,
              level: "safe",
              reasons: [],
              externalEffects: [],
              confirmation: "none",
              expectedAppBoundaries: [],
              maximumActions: 0,
              maximumDurationMs: 0,
              cleanupRequired: false,
            },
            summary: {
              recipes: 1,
              checkedSelectors: 0,
              resolvedSelectors: 0,
              unknownCursorTransitions: 0,
              reviewRequiredReturns: 0,
              blockers: 0,
              warnings: 0,
            },
            selectors: [],
            cursorTimeline: [],
            findings: [],
          },
        },
      },
      {
        id: "workflow.create",
        output: {
          disposition: "created",
          workflow: {
            ...reserved,
            record: {
              ...unstarted,
              frozenIdentity: {
                ...frozen,
                target: { kind: "device", platform: "android", targetId: native.id },
              },
            },
          },
        },
      },
      { id: "app-map.test.run", error: new Error("fixture stops after receiving admission") },
    ]);
    const result = await createJobs(scripted.client, { actorId: "agent:test" }).run({
      kind: "run-test",
      appMapId: "app-1",
      testId: "test-1",
      targetId: native.id,
      variables,
    });
    const runs = scripted.invocations.filter(({ id }) => id === "app-map.test.run");
    assert.equal(
      runs.length,
      1,
      JSON.stringify({ result, invoked: scripted.invocations.map(({ id }) => id) }),
    );
    assert.deepEqual((runs[0]!.input as { variables?: unknown }).variables, variables);
    assert.equal(result.phase, "needs-attention");
    assert.equal(JSON.stringify(result).includes(variables.token), false);
    assert.equal(scripted.remaining(), 0);
  }
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
