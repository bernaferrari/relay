import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSession, DurableWorkflowOperationOutput } from "@relay/protocol";
import { authoringInputReceiptOutcome, type AuthoringInputReceiptRef } from "./index.js";

const target = {
  kind: "browser",
  platform: "browser",
  targetId: "browser-1",
  liveSessionId: "live-1",
} as const;
const expected: AuthoringInputReceiptRef = {
  mutationId: "recording-winner",
  workflowId: "workflow-1",
  sessionId: "session-1",
  transitionVersion: 5,
  target,
};
const session: AuthoringSession = {
  schemaVersion: 1,
  id: "session-1",
  organizationId: "local",
  projectId: "default",
  actorId: "human:test",
  actorKind: "human",
  appMapId: "app-1",
  state: "recording",
  target,
  leaseId: "lease-1",
  expectedAppMapRevision: 2,
  createdAt: 1,
  updatedAt: 10,
  workflowMutation: {
    mutationId: "recording-winner",
    workflowId: "workflow-1",
    transitionVersion: 5,
    action: "authoring-record",
    completedAt: 10,
  },
};
function output(): DurableWorkflowOperationOutput {
  return {
    workflow: {
      record: {
        schemaVersion: 1,
        workflowId: "workflow-1",
        organizationId: "local",
        projectId: "default",
        kind: "author-test",
        version: 6,
        status: "active",
        frozenIdentity: { target },
        resource: { kind: "authoring-session", id: "session-1" },
        createdBy: "human:test",
        lastActorId: "human:test",
        createdAt: 1,
        updatedAt: 10,
        expiresAt: 100_000,
        lastTransition: "authoring-record-completed",
      },
      audit: [],
    },
    session: structuredClone(session),
  };
}

test("the exact completed or reconciled recording receipt proves applied input", () => {
  const completed = output();
  assert.equal(authoringInputReceiptOutcome(completed, expected), "applied");
  completed.workflow.record.version = 7;
  completed.workflow.record.lastTransition = "authoring-record-reconciled";
  assert.equal(authoringInputReceiptOutcome(completed, expected), "applied");
});

for (const platform of ["ios", "android"] as const) {
  test(`${platform} late acknowledgement requires the exact completed mutation`, () => {
    const native = { kind: "device", platform, targetId: "native-1" } as const;
    const receipt = output();
    const nativeExpected = { ...expected, target: native };
    const nativeSession = receipt.session as AuthoringSession;
    nativeSession.target = native;
    assert.equal(authoringInputReceiptOutcome(receipt, nativeExpected), "applied");
    nativeSession.workflowMutation!.mutationId = "another-native-command";
    assert.equal(authoringInputReceiptOutcome(receipt, nativeExpected), "unknown");
    nativeSession.workflowMutation!.mutationId = nativeExpected.mutationId;
    nativeSession.state = "failed";
    assert.equal(authoringInputReceiptOutcome(receipt, nativeExpected), "unknown");
    nativeSession.state = "recording";
    receipt.workflow.record.lastTransition = "authoring-record-requested";
    assert.equal(authoringInputReceiptOutcome(receipt, nativeExpected), "unknown");
  });
}

for (const [label, change] of [
  [
    "another caller's identical input",
    (value: DurableWorkflowOperationOutput) => {
      (value.session as AuthoringSession).workflowMutation!.mutationId = "recording-other";
    },
  ],
  [
    "legacy receipt without a client mutation identity",
    (value: DurableWorkflowOperationOutput) => {
      Reflect.deleteProperty((value.session as AuthoringSession).workflowMutation!, "mutationId");
    },
  ],
  [
    "old session",
    (value: DurableWorkflowOperationOutput) => {
      (value.session as AuthoringSession).id = "old-session";
    },
  ],
  [
    "different mutation",
    (value: DurableWorkflowOperationOutput) => {
      (value.session as AuthoringSession).workflowMutation!.transitionVersion = 3;
    },
  ],
  [
    "different action",
    (value: DurableWorkflowOperationOutput) => {
      (value.session as AuthoringSession).workflowMutation!.action = "authoring-checkpoint";
    },
  ],
  [
    "different workflow",
    (value: DurableWorkflowOperationOutput) => {
      (value.session as AuthoringSession).workflowMutation!.workflowId = "other-workflow";
    },
  ],
  [
    "different browser session",
    (value: DurableWorkflowOperationOutput) => {
      (value.session as AuthoringSession).target = { ...target, liveSessionId: "old-live" };
    },
  ],
  [
    "different browser account",
    (value: DurableWorkflowOperationOutput) => {
      (value.session as AuthoringSession).target = { ...target, authenticationFixtureId: "admin" };
    },
  ],
  [
    "still executing",
    (value: DurableWorkflowOperationOutput) => {
      value.workflow.record.lastTransition = "authoring-record-requested";
      value.workflow.record.version = 5;
    },
  ],
  [
    "unknown result",
    (value: DurableWorkflowOperationOutput) => {
      value.workflow.record.lastTransition = "authoring-record-outcome-unknown";
      value.workflow.record.status = "needs-attention";
    },
  ],
  [
    "only healthy session",
    (value: DurableWorkflowOperationOutput) => {
      delete (value.session as AuthoringSession).workflowMutation;
    },
  ],
] as const) {
  test(`${label} cannot release the input fence`, () => {
    const value = output();
    change(value);
    assert.equal(authoringInputReceiptOutcome(value, expected), "unknown");
  });
}

test("a failed workflow transition without the exact successful receipt stays fenced", () => {
  const value = output();
  value.workflow.record.lastTransition = "authoring-record-failed";
  delete (value.session as AuthoringSession).workflowMutation;
  assert.equal(authoringInputReceiptOutcome(value, expected), "unknown");
  value.workflow.record.version = 8;
  assert.equal(authoringInputReceiptOutcome(value, expected), "unknown");
});

test("missing or blank expected mutation identity cannot prove input applied", () => {
  for (const mutationId of [undefined, "", " "]) {
    assert.equal(
      authoringInputReceiptOutcome(output(), {
        ...expected,
        mutationId,
      } as AuthoringInputReceiptRef),
      "unknown",
    );
  }
});
