import type { OperationContext } from "./operation-context.js";
import type { TestJob } from "./session-contract.js";

export class HumanInterventionReproofUnavailableError extends Error {
  readonly code = "HUMAN_INTERVENTION_REPROOF_UNQUALIFIED" as const;

  constructor() {
    super(
      "Resume requires a fresh current accessibility snapshot with named controls; pixels-only or stale observations keep the intervention paused.",
    );
    this.name = "HumanInterventionReproofUnavailableError";
  }
}

type InterventionArtifactData = {
  requestCapturedAt?: number;
  requestId?: string;
};

function dataOf(artifact: TestJob["artifacts"][number]): InterventionArtifactData {
  return artifact.data && typeof artifact.data === "object"
    ? (artifact.data as InterventionArtifactData)
    : {};
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * A human action changes the target outside Relay's command boundary. Before
 * a paused run can resume, the replacement observation must be the semantic
 * capture that just completed—not a deterministic empty-tree digest, a stale
 * AX proof, or a pixels-only fallback whose raster is not durable evidence.
 */
function isQualifiedHumanInterventionReproof(observation: unknown): boolean {
  const value = objectValue(observation);
  if (!value || value.inspectable !== true) return false;
  const capturedAt = value.capturedAt;
  if (typeof capturedAt !== "number" || !Number.isFinite(capturedAt)) return false;
  if (
    typeof value.nodeCount !== "number" ||
    !Number.isInteger(value.nodeCount) ||
    value.nodeCount < 1
  ) {
    return false;
  }
  const screenIdentity = objectValue(value.screenIdentity);
  if (
    !screenIdentity ||
    typeof screenIdentity.fingerprint !== "string" ||
    !screenIdentity.fingerprint.trim()
  ) {
    return false;
  }
  const semantic = objectValue(objectValue(value.readiness)?.semanticControl);
  const proof = objectValue(semantic?.proof);
  return (
    semantic?.state === "proven" &&
    semantic.freshness === "current" &&
    typeof proof?.at === "number" &&
    Number.isFinite(proof.at) &&
    proof.at === capturedAt
  );
}

export function assertQualifiedHumanInterventionReproof(observation: unknown): void {
  if (!isQualifiedHumanInterventionReproof(observation)) {
    throw new HumanInterventionReproofUnavailableError();
  }
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
  assertQualifiedHumanInterventionReproof(observation);
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
