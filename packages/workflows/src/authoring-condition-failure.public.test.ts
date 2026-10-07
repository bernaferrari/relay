import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSession, DurableWorkflowOperationOutput } from "@relay/protocol";
import { createRelayWorkflows, type DurableAuthorTestDecision } from "./index.js";
import { createScriptedRelayClient } from "./testing.js";

const target = { kind: "device", platform: "ios", targetId: "ipad-fixture" } as const;
const decision: DurableAuthorTestDecision = {
  workflowId: "condition-workflow",
  expectedVersion: 6,
  action: "record",
  mutationId: "condition-request",
  interaction: {
    kind: "steps",
    label: "Wait until Copy appears",
    steps: [{ kind: "wait-for", target: { text: "Copy" }, timeoutMs: 120_000 }],
  },
};
const detail = 'Step 1 (wait for text "Copy"): wait-for: timed out waiting for text "Copy"';

function failureReceipt(): DurableWorkflowOperationOutput {
  const source = { kind: "authoring-runtime", target } as const;
  const session: AuthoringSession = {
    schemaVersion: 1,
    id: "condition-session",
    organizationId: "local",
    projectId: "default",
    actorId: "human:condition",
    actorKind: "human",
    appMapId: "grok-ios",
    testName: "Fast chat",
    workflowRequestId: "record-request",
    originApplication: "Grok",
    state: "recording",
    target,
    leaseId: "lease-fixture",
    expectedAppMapRevision: 7,
    createdAt: 1,
    updatedAt: 2,
    take: {
      id: "condition-take",
      state: "recording",
      createdAt: 1,
      updatedAt: 2,
      currentRevision: 1,
      revisions: [
        {
          id: "revision-1",
          takeId: "condition-take",
          revision: 1,
          createdAt: 1,
          createdBy: "human:condition",
          reason: "recording",
          actions: [],
          evidence: [],
        },
      ],
      replayAttempts: [],
      rawCaptureVersion: 2,
      rawEvents: [
        {
          id: "wait-intent",
          kind: "interaction-intent",
          sequence: 10,
          source,
          recordedAt: 10,
          startedAt: 10,
          interaction: { kind: "steps", stepCount: 1, hasLabel: true },
          links: { evidenceIds: [] },
        },
        {
          id: "wait-failed",
          kind: "interaction-outcome",
          sequence: 11,
          source,
          recordedAt: 12,
          finishedAt: 12,
          intentEventId: "wait-intent",
          outcome: "failed",
          links: { evidenceIds: [] },
        },
      ],
    },
  };
  return {
    workflow: {
      record: {
        schemaVersion: 1,
        workflowId: decision.workflowId,
        organizationId: "local",
        projectId: "default",
        kind: "author-test",
        version: 8,
        status: "active",
        lastTransition: "authoring-record-failed",
        frozenIdentity: {
          title: "Fast chat",
          actorId: session.actorId,
          appMapId: session.appMapId,
          appMapRevision: 7,
          target,
          originApplication: "Grok",
          workflowRequestId: "record-request",
        },
        resource: { kind: "authoring-session", id: session.id },
        createdBy: session.actorId,
        lastActorId: session.actorId,
        createdAt: 1,
        updatedAt: 12,
        expiresAt: 100_000,
      },
      audit: [],
    },
    session: session as unknown as Record<string, unknown>,
  };
}

function terminalError(output = failureReceipt()) {
  return Object.assign(new Error(detail), {
    status: 422,
    body: { code: "AUTHORING_INTERACTION_FAILED", ...output },
  });
}

test("the submitted recorded Wait retains its matching terminal 422 failure without another read or dispatch", async () => {
  const scripted = createScriptedRelayClient([
    { id: "workflow.transition", error: terminalError() },
  ]);
  const result = await createRelayWorkflows(scripted.client).advanceAuthoring(decision);
  assert.equal(result.problems.at(-1)?.code, "operation-unavailable");
  assert.equal(result.problems.at(-1)?.sourceCode, "AUTHORING_INTERACTION_FAILED");
  assert.equal(result.problems.at(-1)?.detail, detail);
  assert.equal(result.stage, "recording");
  assert.ok(result.allowedNextActions.includes("record"));
  assert.equal(result.review?.actionCount, 0);
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["workflow.transition"],
  );
});

const invalid: [string, (error: ReturnType<typeof terminalError>) => void][] = [
  [
    "arbitrary 422",
    (error) => {
      error.body.code = "OTHER_FAILURE";
    },
  ],
  [
    "transport status",
    (error) => {
      error.status = 504;
    },
  ],
  [
    "another workflow",
    (error) => {
      error.body.workflow.record.workflowId = "another";
    },
  ],
  [
    "later version",
    (error) => {
      error.body.workflow.record.version += 1;
    },
  ],
  [
    "pending workflow",
    (error) => {
      error.body.workflow.record.lastTransition = "authoring-record-requested";
    },
  ],
  [
    "uncertain workflow",
    (error) => {
      error.body.workflow.record.status = "needs-attention";
    },
  ],
  [
    "another session",
    (error) => {
      error.body.session!.id = "other-session";
    },
  ],
  [
    "another project",
    (error) => {
      error.body.session!.projectId = "another";
    },
  ],
  [
    "another target",
    (error) => {
      error.body.session!.target = { ...target, targetId: "another" };
    },
  ],
  [
    "renamed draft identity",
    (error) => {
      error.body.session!.testName = "Different draft";
    },
  ],
  [
    "changed App Map revision",
    (error) => {
      error.body.session!.expectedAppMapRevision = 8;
    },
  ],
  [
    "unknown outcome",
    (error) => {
      const event = (error.body.session as unknown as AuthoringSession).take!.rawEvents!.at(-1)!;
      if (event.kind === "interaction-outcome") event.outcome = "unknown";
    },
  ],
  [
    "successful outcome",
    (error) => {
      const event = (error.body.session as unknown as AuthoringSession).take!.rawEvents!.at(-1)!;
      if (event.kind === "interaction-outcome") event.outcome = "succeeded";
    },
  ],
  [
    "receipt older than terminal evidence",
    (error) => {
      error.body.workflow.record.updatedAt = 11;
    },
  ],
  [
    "terminal timestamp before dispatch",
    (error) => {
      const event = (error.body.session as unknown as AuthoringSession).take!.rawEvents!.at(-1)!;
      if (event.kind === "interaction-outcome") event.finishedAt = 9;
    },
  ],
  [
    "terminal evidence from another target",
    (error) => {
      const event = (error.body.session as unknown as AuthoringSession).take!.rawEvents!.at(-1)!;
      event.source = { kind: "authoring-runtime", target: { ...target, targetId: "another" } };
    },
  ],
  [
    "unlinked outcome",
    (error) => {
      const event = (error.body.session as unknown as AuthoringSession).take!.rawEvents!.at(-1)!;
      if (event.kind === "interaction-outcome") event.intentEventId = "another-intent";
    },
  ],
];
for (const [name, change] of invalid) {
  test(`keeps ${name} unknown even when a later recording inspection is healthy`, async () => {
    const error = terminalError();
    change(error);
    const scripted = createScriptedRelayClient([
      { id: "workflow.transition", error },
      { id: "workflow.get", output: failureReceipt() },
    ]);
    const result = await createRelayWorkflows(scripted.client).advanceAuthoring(decision);
    assert.equal(result.problems.at(-1)?.code, "mutation-outcome-unknown");
    assert.deepEqual(
      scripted.invocations.map(({ id }) => id),
      ["workflow.transition", "workflow.get"],
    );
  });
}

test("a failed native tap cannot borrow a recorded Wait's terminal classification", async () => {
  const scripted = createScriptedRelayClient([
    { id: "workflow.transition", error: terminalError() },
    { id: "workflow.get", output: failureReceipt() },
  ]);
  const result = await createRelayWorkflows(scripted.client).advanceAuthoring({
    ...decision,
    action: "record",
    interaction: { kind: "tap", target: { label: "Send" } },
  });
  assert.equal(result.problems.at(-1)?.code, "mutation-outcome-unknown");
});
