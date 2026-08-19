import assert from "node:assert/strict";
import test from "node:test";
import type { OperationContext } from "./operation-context.js";
import {
  humanInterventionNeedsReproof,
  operationOwnsHumanIntervention,
  recordHumanInterventionAuthorization,
  recordHumanInterventionReproof,
} from "./job-intervention.js";
import type { TestJob } from "./session-contract.js";

function operation(actorId = "agent:runner", requestId = crypto.randomUUID()): OperationContext {
  return {
    schemaVersion: 1,
    organizationId: "org",
    projectId: "project",
    actorId,
    actorKind: "agent",
    operationId: "target.interact",
    requestId,
    idempotencyKey: requestId,
    issuedAt: Date.now(),
  };
}

function pausedJob(): TestJob {
  return {
    id: "job-paused",
    projectId: "project",
    operationContext: operation(),
    status: "paused",
    waitingFor: {
      kind: "human",
      message: "Repair Birth year",
      reason: "review",
      resumeLabel: "Resume",
      since: 100,
    },
    artifacts: [
      {
        kind: "human-intervention-requested",
        capturedAt: 99,
        data: { reason: "review" },
      },
    ],
  } as TestJob;
}

test("paused intervention belongs only to the exact project and actor", () => {
  const job = pausedJob();
  assert.deepEqual(operationOwnsHumanIntervention(job, operation()), { requestCapturedAt: 99 });
  assert.equal(operationOwnsHumanIntervention(job, operation("human:other")), undefined);
  assert.equal(
    operationOwnsHumanIntervention(job, { ...operation(), projectId: "other-project" }),
    undefined,
  );
  job.status = "running";
  assert.equal(operationOwnsHumanIntervention(job, operation()), undefined);
});

test("manual intervention has immutable authorization and re-proof lineage", () => {
  const job = pausedJob();
  const authorized = operation();
  recordHumanInterventionAuthorization(job, authorized, 99);
  recordHumanInterventionAuthorization(job, authorized, 99);
  assert.equal(
    job.artifacts.filter((artifact) => artifact.kind === "human-intervention-authorized").length,
    1,
  );
  assert.equal(humanInterventionNeedsReproof(job), true);

  recordHumanInterventionReproof(job, operation(), {
    screenIdentity: { fingerprint: "birth-year-closed" },
  });
  assert.equal(humanInterventionNeedsReproof(job), false);

  recordHumanInterventionAuthorization(job, operation(), 99);
  assert.equal(humanInterventionNeedsReproof(job), true, "a later edit invalidates the old proof");
});
