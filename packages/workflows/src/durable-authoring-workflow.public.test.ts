import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSession, DurableWorkflowRead } from "@relay/protocol";
import { createRelayWorkflows, type AuthorTestIntent } from "./index.js";
import { createScriptedRelayClient } from "./testing.js";

const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;
const frozen = {
  title: "Settings localization",
  actorId: "agent:test",
  appMapId: "settings",
  appMapRevision: 7,
  target,
  originApplication: "com.android.settings",
  workflowRequestId: "author-request-1",
} as const;
const session = {
  schemaVersion: 1,
  id: "authoring-1",
  organizationId: "local",
  projectId: "default",
  actorId: "agent:test",
  actorKind: "agent",
  appMapId: "settings",
  workflowRequestId: "author-request-1",
  testName: "Settings localization",
  state: "recording",
  target,
  originApplication: "com.android.settings",
  captureProvenance: { schemaVersion: 1, mode: "control-and-record", origin: "relay-control" },
  leaseId: "lease-1",
  expectedAppMapRevision: 7,
  createdAt: 1,
  updatedAt: 2,
} satisfies AuthoringSession;

function workflow(version: number, transition = "created"): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: "author-workflow",
      organizationId: "local",
      projectId: "default",
      kind: "author-test",
      version,
      status: "active",
      frozenIdentity: frozen,
      ...(version > 1 ? { resource: { kind: "authoring-session" as const, id: session.id } } : {}),
      createdBy: "agent:test",
      lastActorId: "agent:test",
      createdAt: 1,
      updatedAt: version,
      expiresAt: 100_000,
      lastTransition: transition,
    },
    audit: [],
  };
}

function intent(): AuthorTestIntent {
  return {
    kind: "author-test",
    actorId: "agent:test",
    title: "Settings localization",
    appMapId: "settings",
    target,
    originApplication: "com.android.settings",
    leaseId: "lease-1",
    revision: { exact: 7 },
    workflowRequestId: "author-request-1",
    continuation: "durable",
  };
}

test("durable Authoring reserves before control and returns only workflow id plus version", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "workflow.create",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "author-request-1",
          kind: "author-test",
          frozenIdentity: frozen,
        }),
      output: { disposition: "created", workflow: workflow(1) },
    },
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "author-workflow",
          expectedVersion: 1,
          action: "start-authoring",
          leaseId: "lease-1",
        }),
      output: { workflow: workflow(3, "authoring-started"), session },
    },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.equal(snapshot.frozen?.originApplication, "com.android.settings");
  assert.equal(snapshot.stage, "recording");
  assert.equal(snapshot.title, "Settings localization");
  assert.equal(snapshot.capture?.provenance.mode, "control-and-record");
  assert.deepEqual(snapshot.workflow, { workflowId: "author-workflow", expectedVersion: 3 });
  assert.equal(snapshot.ref, undefined);
  assert.equal(JSON.stringify(snapshot).includes("relay-workflow.v1."), false);
});

test("durable Authoring inspect and stop carry only workflow id plus one CAS version", async () => {
  const reviewing = { ...session, state: "reviewing" as const, updatedAt: 3 };
  const scripted = createScriptedRelayClient([
    { id: "workflow.get", output: { workflow: workflow(3, "authoring-started"), session } },
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "author-workflow",
          expectedVersion: 3,
          action: "authoring-stop",
        }),
      output: { workflow: workflow(5, "authoring-stop-completed"), session: reviewing },
    },
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const inspected = await workflows.inspectAuthoring("author-workflow");
  assert.equal(inspected.stage, "recording");
  const stopped = await workflows.advanceAuthoring({
    workflowId: "author-workflow",
    expectedVersion: 3,
    action: "stop",
  });
  assert.equal(stopped.stage, "reviewing");
  assert.deepEqual(stopped.workflow, { workflowId: "author-workflow", expectedVersion: 5 });
});

test("an uncertain durable Authoring decision is inspected and never retried", async () => {
  const uncertain = {
    ...workflow(4, "authoring-cancel-outcome-unknown"),
    record: {
      ...workflow(4, "authoring-cancel-outcome-unknown").record,
      status: "needs-attention" as const,
    },
  };
  const scripted = createScriptedRelayClient([
    { id: "workflow.transition", error: new Error("response lost") },
    { id: "workflow.get", output: { workflow: uncertain, session } },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).advanceAuthoring({
    workflowId: "author-workflow",
    expectedVersion: 3,
    action: "cancel",
  });

  assert.equal(snapshot.phase, "needs-attention");
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["workflow.transition", "workflow.get"],
  );
});

test("durable recording retains typed pre-dispatch proof after inspecting the failed decision", async () => {
  const error = Object.assign(new Error("Target inspection failed before tap"), {
    body: { code: "input-not-dispatched", dispatched: false },
  });
  const scripted = createScriptedRelayClient([
    { id: "workflow.transition", error },
    { id: "workflow.get", output: { workflow: workflow(5, "authoring-record-failed"), session } },
  ]);
  const state = await createRelayWorkflows(scripted.client).advanceAuthoring({
    workflowId: "author-workflow",
    expectedVersion: 3,
    action: "record",
    interaction: { kind: "tap", target: { label: "Continue" } },
  });
  assert.equal(state.problems.at(-1)?.code, "input-not-dispatched");
  assert.ok(state.allowedNextActions.includes("record"));
  assert.equal(scripted.invocations.filter((call) => call.id === "workflow.transition").length, 1);
});

test("durable recording forwards the exact client mutation identity", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "author-workflow",
          expectedVersion: 3,
          action: "authoring-record",
          interaction: { kind: "wait", ms: 1 },
          mutationId: "recording-1",
        }),
      output: { workflow: workflow(5, "authoring-record-completed"), session },
    },
  ]);
  const state = await createRelayWorkflows(scripted.client).advanceAuthoring({
    workflowId: "author-workflow",
    expectedVersion: 3,
    action: "record",
    interaction: { kind: "wait", ms: 1 },
    mutationId: "recording-1",
  });
  assert.equal(state.stage, "recording");
  assert.deepEqual(state.problems, []);
});

test("a failed inspection cannot impersonate a fresh workflow version", async () => {
  const scripted = createScriptedRelayClient([{ id: "workflow.get", error: new Error("Offline") }]);
  const snapshot = await createRelayWorkflows(scripted.client).inspectAuthoring("author-workflow");
  assert.equal(snapshot.version, "unavailable");
  assert.equal(snapshot.stage, "unknown");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
});
