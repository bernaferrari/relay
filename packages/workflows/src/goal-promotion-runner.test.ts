import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthoringSession,
  GoalSessionRecord,
  OperationId,
  OperationInput,
  OperationOutput,
  DurableWorkflowRead,
} from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";
import { createGoalPromotionRunner } from "./goal-promotion-runner.js";

const target = { kind: "browser", platform: "browser", targetId: "goal-test-goal-1" } as const;

function session(state: AuthoringSession["state"]): AuthoringSession {
  return {
    schemaVersion: 1,
    id: "authoring-goal-1",
    organizationId: "local",
    projectId: "default",
    actorId: "agent:test",
    actorKind: "agent",
    appMapId: "map-1",
    testName: "Empty cart regression",
    state,
    target,
    captureProvenance: { schemaVersion: 1, mode: "control-and-record", origin: "relay-control" },
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function workflow(version: number, lastTransition: string): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: "goal-promote-goal-1",
      organizationId: "local",
      projectId: "default",
      kind: "author-test",
      version,
      status: "active",
      frozenIdentity: {
        title: "Empty cart regression",
        actorId: "agent:test",
        appMapId: "map-1",
        appMapRevision: 1,
        target,
        workflowRequestId: "goal-promote-goal-1",
      },
      createdBy: "agent:test",
      lastActorId: "agent:test",
      createdAt: 1,
      updatedAt: version,
      expiresAt: 10_000,
      lastTransition,
    },
    audit: [],
  };
}

function goal(): GoalSessionRecord {
  return {
    schemaVersion: 1,
    id: "goal-1",
    goal: "Try to submit an empty cart",
    target: {
      targetId: "goal-1",
      platform: "browser",
      startUrl: "https://example.test",
    },
    budget: { maxSteps: 4, maxDurationMs: 10_000 },
    status: "completed",
    step: 1,
    createdAt: 1,
    updatedAt: 2,
    observations: [],
    actions: [],
    reproduction: {
      id: "repro-goal-1",
      sourceSessionId: "goal-1",
      target: {
        targetId: "goal-repro-goal-1",
        platform: "browser",
        startUrl: "https://example.test",
      },
      status: "reproduced",
      startedAt: 2,
      updatedAt: 3,
      observations: [],
      actions: [
        {
          id: "repro-action-1",
          step: 1,
          candidateId: "c1",
          label: "Submit",
          interaction: { kind: "label", target: { label: "Submit" } },
          status: "acknowledged",
          observationDigestBefore: "before",
          observationDigestAfter: "after",
          evidenceRefs: [],
          at: 3,
        },
      ],
      stopReason: { code: "goal-achieved", message: "reproduced", at: 3 },
    },
  };
}

function operations(calls: OperationId[]): RelayOperationPort {
  return {
    async invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>) {
      calls.push(id);
      if (id === "target.list") return { targets: [] } as OperationOutput<Id>;
      if (id === "target.create") {
        return {
          target: {
            id: (input as { id: string }).id,
            name: "Goal Test",
            kind: "browser",
            createdAt: 1,
            updatedAt: 1,
            browser: { startUrl: "https://example.test", profileRetention: "ephemeral" },
          },
        } as OperationOutput<Id>;
      }
      if (id === "target.open") {
        return {
          session: { targetId: target.targetId, name: "Goal Test", url: "https://example.test" },
        } as OperationOutput<Id>;
      }
      if (id === "app-map.list") return { appMaps: [] } as OperationOutput<Id>;
      if (id === "app-map.create") {
        return { appMap: { id: "map-1", revision: 0 } } as OperationOutput<Id>;
      }
      if (id === "app-map.get") return { appMap: { revision: 1 } } as OperationOutput<Id>;
      if (id === "lease.list") return { leases: [] } as OperationOutput<Id>;
      if (id === "lease.create") {
        return {
          lease: {
            id: "lease-1",
            projectId: "default",
            poolId: "local",
            deviceSerial: target.targetId,
            ownerId: "agent:test",
            status: "leased",
            controlScope: "local-project",
            leasedAt: 1,
            expiresAt: 10_000,
          },
        } as OperationOutput<Id>;
      }
      if (id === "workflow.create") {
        return { disposition: "created", workflow: workflow(1, "created") } as OperationOutput<Id>;
      }
      if (id === "workflow.transition") {
        const action = (input as { action: string }).action;
        const version =
          action === "start-authoring"
            ? 3
            : action === "authoring-record"
              ? 4
              : action === "authoring-stop"
                ? 5
                : 6;
        const state =
          action === "authoring-stop" || action === "authoring-replay" ? "reviewing" : "recording";
        return {
          workflow: workflow(version, action),
          session: session(state),
        } as OperationOutput<Id>;
      }
      throw new Error(`Unexpected operation ${id}`);
    },
  };
}

test("goal promotion records and replays a fresh path but never approves it", async () => {
  const calls: OperationId[] = [];
  const runner = createGoalPromotionRunner({
    operations: operations(calls),
    sessions: { inspect: async () => goal() },
    actorId: "agent:test",
  });
  const snapshot = await runner.promote({
    sessionId: "goal-1",
    title: "Empty cart regression",
    appMapId: "map-1",
    confirmControl: true,
  });
  assert.equal(snapshot.stage, "reviewing");
  assert.equal(snapshot.allowedNextActions.includes("approve"), false);
  assert.equal(calls.filter((id) => id === "workflow.transition").length, 4);
  assert.equal(calls.includes("authoring.session.commit"), false);
});
