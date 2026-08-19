import type { OperationContext } from "./operation-context.js";
import type { TestJob } from "./session-contract.js";

type InterventionArtifactData = {
  requestCapturedAt?: number;
  requestId?: string;
};

function dataOf(artifact: TestJob["artifacts"][number]): InterventionArtifactData {
  return artifact.data && typeof artifact.data === "object"
    ? (artifact.data as InterventionArtifactData)
    : {};
}

function lastArtifactIndex(
  job: TestJob,
  predicate: (artifact: TestJob["artifacts"][number]) => boolean,
): number {
  for (let index = job.artifacts.length - 1; index >= 0; index -= 1) {
    if (predicate(job.artifacts[index]!)) return index;
  }
  return -1;
}

export function humanInterventionRequest(job: TestJob): { capturedAt: number } | undefined {
  if (job.status !== "paused" || job.waitingFor?.kind !== "human") return undefined;
  return job.artifacts
    .filter((artifact) => artifact.kind === "human-intervention-requested")
    .at(-1);
}

export function operationOwnsHumanIntervention(
  job: TestJob,
  operation: OperationContext,
): { requestCapturedAt: number } | undefined {
  const request = humanInterventionRequest(job);
  if (!request) return undefined;
  const projectId = job.projectId ?? job.operationContext?.projectId;
  if (!projectId || projectId !== operation.projectId) return undefined;
  if (!job.operationContext?.actorId || job.operationContext.actorId !== operation.actorId) {
    return undefined;
  }
  return { requestCapturedAt: request.capturedAt };
}

/** Append-only authorization lineage. Each command request gets one record. */
export function recordHumanInterventionAuthorization(
  job: TestJob,
  operation: OperationContext,
  requestCapturedAt: number,
): void {
  if (
    job.artifacts.some(
      (artifact) =>
        artifact.kind === "human-intervention-authorized" &&
        dataOf(artifact).requestId === operation.requestId,
    )
  ) {
    return;
  }
  job.artifacts.push({
    kind: "human-intervention-authorized",
    capturedAt: Date.now(),
    data: {
      schemaVersion: 1,
      jobId: job.id,
      requestCapturedAt,
      actorId: operation.actorId,
      actorKind: operation.actorKind,
      operationId: operation.operationId,
      requestId: operation.requestId,
      causationId: operation.causationId,
      correlationId: operation.correlationId,
      status: "authorized",
    },
  });
}

export function humanInterventionNeedsReproof(job: TestJob): boolean {
  const request = humanInterventionRequest(job);
  if (!request) return false;
  const authorizationIndex = lastArtifactIndex(
    job,
    (artifact) =>
      artifact.kind === "human-intervention-authorized" &&
      dataOf(artifact).requestCapturedAt === request.capturedAt,
  );
  if (authorizationIndex < 0) return false;
  const proofIndex = lastArtifactIndex(
    job,
    (artifact) =>
      artifact.kind === "human-intervention-reproof" &&
      dataOf(artifact).requestCapturedAt === request.capturedAt,
  );
  return proofIndex < authorizationIndex;
}

export function recordHumanInterventionReproof(
  job: TestJob,
  operation: OperationContext,
  observation: unknown,
): void {
  const owned = operationOwnsHumanIntervention(job, operation);
  if (!owned) throw new Error("Only the intervention owner can re-prove the paused target state");
  job.artifacts.push({
    kind: "human-intervention-reproof",
    capturedAt: Date.now(),
    data: {
      schemaVersion: 1,
      jobId: job.id,
      requestCapturedAt: owned.requestCapturedAt,
      actorId: operation.actorId,
      requestId: operation.requestId,
      observation: structuredClone(observation),
      status: "observed",
    },
  });
}
