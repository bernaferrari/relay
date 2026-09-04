import assert from "node:assert/strict";
import test from "node:test";
import type { DurableWorkflowRead, ExecutionRisk } from "@relay/protocol";
import { createRelayWorkflows, type RunTestIntent } from "./index.js";
import { createScriptedRelayClient, type ScriptedRelayStep } from "./testing.js";

const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;
const frozen = {
  appMapId: "settings",
  appMapRevision: 7,
  testId: "smoke",
  planDigest: "plan-7",
  workflowRequestId: "workflow-1",
  target,
} as const;
const risk: ExecutionRisk = {
  schemaVersion: 1,
  level: "safe",
  reasons: [],
  externalEffects: [],
  confirmation: "none",
  expectedAppBoundaries: [],
  maximumActions: 0,
  maximumDurationMs: 0,
  cleanupRequired: false,
};

function workflow(
  version: number,
  input: {
    status?: "active" | "needs-attention" | "terminal";
    transition?: string;
    resource?: { kind: "job"; id: string };
    identity?: typeof frozen & { rootRecipeId?: string };
  } = {},
): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: "workflow-1",
      organizationId: "local",
      projectId: "default",
      kind: "run-test",
      version,
      status: input.status ?? "active",
      frozenIdentity: input.identity ?? frozen,
      ...(input.resource ? { resource: input.resource } : {}),
      createdBy: "agent:test",
      lastActorId: "agent:test",
      createdAt: 1,
      updatedAt: version,
      expiresAt: 100_000,
      lastTransition: input.transition ?? "created",
    },
    audit: [],
  };
}

function compile(): ScriptedRelayStep {
  return {
    id: "app-map.test.compile",
    output: {
      plan: { rootRecipeId: "open-settings" },
      preflight: {
        schemaVersion: 1,
        mode: "offline-test-preflight",
        appMapId: "settings",
        appMapRevision: 7,
        testId: "smoke",
        planDigest: "plan-7",
        executionRisk: risk,
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
        returns: [],
        findings: [],
      },
    },
  };
}

const job = {
  id: "job-1",
  action: "app-map.test.run",
  status: "queued",
  queuedAt: 10,
};

function intent(): RunTestIntent {
  return {
    kind: "run-test",
    appMapId: "settings",
    testId: "smoke",
    target,
    revision: { exact: 7 },
    workflowRequestId: "workflow-1",
    continuation: "durable",
  };
}

test("durable Run reserves identity before enqueue and returns only workflow id plus version", async () => {
  const scripted = createScriptedRelayClient([
    compile(),
    {
      id: "workflow.create",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "workflow-1",
          kind: "run-test",
          frozenIdentity: frozen,
        }),
      output: { disposition: "created", workflow: workflow(1) },
    },
    {
      id: "app-map.test.run",
      output: {
        planIdentity: {
          appMapId: "settings",
          appMapRevision: 7,
          testId: "smoke",
          rootRecipeId: "open-settings",
        },
        plan: { rootRecipeId: "open-settings" },
        job,
      },
    },
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "workflow-1",
          expectedVersion: 1,
          action: "attach-run",
          jobId: "job-1",
        }),
      output: {
        workflow: workflow(2, {
          transition: "run-attached",
          resource: { kind: "job", id: "job-1" },
          identity: { ...frozen, rootRecipeId: "open-settings" },
        }),
        job,
      },
    },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.deepEqual(snapshot.workflow, { workflowId: "workflow-1", expectedVersion: 2 });
  assert.equal(snapshot.ref, undefined);
  assert.equal(JSON.stringify(snapshot).includes("relay-workflow.v1."), false);
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile", "workflow.create", "app-map.test.run", "workflow.transition"],
  );
});

test("an existing request is reconciled and never dispatches the Run again", async () => {
  const attached = workflow(2, {
    transition: "run-attached",
    resource: { kind: "job", id: "job-1" },
    identity: { ...frozen, rootRecipeId: "open-settings" },
  });
  const scripted = createScriptedRelayClient([
    compile(),
    { id: "workflow.create", output: { disposition: "existing", workflow: attached } },
    { id: "workflow.get", output: { workflow: attached, job } },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.equal(snapshot.phase, "queued");
  assert.deepEqual(snapshot.workflow, { workflowId: "workflow-1", expectedVersion: 2 });
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile", "workflow.create", "workflow.get"],
  );
});

test("an authoritative pre-dispatch rejection terminally abandons its durable reservation", async () => {
  const terminal = workflow(2, { status: "terminal", transition: "run-abandoned" });
  terminal.record.resolution = {
    kind: "abandoned",
    reason: "TARGET_PROFILE_SELECTION_REQUIRED",
    at: 2,
  };
  const scripted = createScriptedRelayClient([
    compile(),
    { id: "workflow.create", output: { disposition: "created", workflow: workflow(1) } },
    {
      id: "app-map.test.run",
      error: Object.assign(new Error("TARGET_PROFILE_SELECTION_REQUIRED"), { status: 409 }),
    },
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "workflow-1",
          expectedVersion: 1,
          action: "abandon-run",
          reason: "TARGET_PROFILE_SELECTION_REQUIRED",
        }),
      output: { workflow: terminal },
    },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.title, "The Test run was rejected before dispatch");
  assert.equal(snapshot.problems[0]?.retryable, false);
  assert.deepEqual(snapshot.workflow, { workflowId: "workflow-1", expectedVersion: 2 });
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile", "workflow.create", "app-map.test.run", "workflow.transition"],
  );
});

test("a malformed post-enqueue response retains the reserved durable handle", async () => {
  const scripted = createScriptedRelayClient([
    compile(),
    { id: "workflow.create", output: { disposition: "created", workflow: workflow(1) } },
    {
      id: "app-map.test.run",
      output: {
        planIdentity: {
          appMapId: "settings",
          appMapRevision: 7,
          testId: "different-test",
          rootRecipeId: "open-settings",
        },
        plan: { rootRecipeId: "open-settings" },
        job,
      },
    },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.equal(snapshot.phase, "needs-attention");
  assert.deepEqual(snapshot.workflow, { workflowId: "workflow-1", expectedVersion: 1 });
  assert.equal(snapshot.ref, undefined);
  assert.equal(snapshot.problems[0]?.code, "mutation-outcome-unknown");
});

test("durable inspect and cancel send only workflow identity plus one CAS version", async () => {
  const attached = workflow(2, {
    transition: "run-attached",
    resource: { kind: "job", id: "job-1" },
    identity: { ...frozen, rootRecipeId: "open-settings" },
  });
  const cancelledJob = { ...job, status: "cancelled", finishedAt: 20 };
  const terminal = workflow(4, {
    status: "terminal",
    transition: "run-cancelled",
    resource: { kind: "job", id: "job-1" },
    identity: { ...frozen, rootRecipeId: "open-settings" },
  });
  const scripted = createScriptedRelayClient([
    { id: "workflow.get", output: { workflow: attached, job } },
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "workflow-1",
          expectedVersion: 2,
          action: "cancel-run",
        }),
      output: { workflow: terminal, job: cancelledJob },
    },
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  assert.equal((await workflows.inspectRun("workflow-1")).phase, "queued");
  const cancelled = await workflows.cancelRun({ workflowId: "workflow-1", expectedVersion: 2 });
  assert.equal(cancelled.phase, "cancelled");
  assert.deepEqual(cancelled.workflow, { workflowId: "workflow-1", expectedVersion: 4 });
  assert.equal(cancelled.ref, undefined);
});
