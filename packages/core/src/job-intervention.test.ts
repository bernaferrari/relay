import assert from "node:assert/strict";
import test from "node:test";
import type { OperationContext } from "./operation-context.js";
import {
  HumanInterventionReproofUnavailableError,
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

function qualifiedReproof(capturedAt = 100): Record<string, unknown> {
  return {
    capturedAt,
    inspectable: true,
    source: "sdk",
    nodeCount: 1,
    screenIdentity: { fingerprint: "birth-year-closed", nodes: [], volatileSignals: [] },
    readiness: {
      semanticControl: {
        mode: "accessibility",
        state: "proven",
        freshness: "current",
        proof: { at: capturedAt, observedNodeCount: 1 },
      },
    },
  };
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

  recordHumanInterventionReproof(job, operation(), qualifiedReproof());
  assert.equal(humanInterventionNeedsReproof(job), false);

  recordHumanInterventionAuthorization(job, operation(), 99);
  assert.equal(humanInterventionNeedsReproof(job), true, "a later edit invalidates the old proof");
});

test("pixels-only and stale intervention observations cannot clear a human pause", () => {
  const job = pausedJob();
  recordHumanInterventionAuthorization(job, operation(), 99);

  const pixelsOnly = qualifiedReproof();
  pixelsOnly.inspectable = false;
  pixelsOnly.nodeCount = 0;
  const pixelsReadiness = pixelsOnly.readiness as { semanticControl: Record<string, unknown> };
  pixelsReadiness.semanticControl = {
    mode: "accessibility",
    state: "unavailable",
    freshness: "unproven",
    reason: "probe-failed",
  };
  assert.throws(
    () => recordHumanInterventionReproof(job, operation(), pixelsOnly),
    HumanInterventionReproofUnavailableError,
  );
  assert.equal(humanInterventionNeedsReproof(job), true);

  const stale = qualifiedReproof();
  const staleReadiness = stale.readiness as { semanticControl: Record<string, unknown> };
  staleReadiness.semanticControl.freshness = "stale";
  assert.throws(
    () => recordHumanInterventionReproof(job, operation(), stale),
    HumanInterventionReproofUnavailableError,
  );
  assert.equal(
    job.artifacts.filter((artifact) => artifact.kind === "human-intervention-reproof").length,
    0,
  );
});
