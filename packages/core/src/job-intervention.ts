import type { AuthoringEvidence } from "@relay/protocol";
import type { OperationContext } from "./operation-context.js";
import type { TestJob } from "./session-contract.js";

export class HumanInterventionReproofUnavailableError extends Error {
  readonly code = "HUMAN_INTERVENTION_REPROOF_UNQUALIFIED" as const;

  constructor(
    message = "Resume requires a fresh current accessibility snapshot with named controls; pixels-only or stale observations keep the intervention paused.",
  ) {
    super(message);
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

function durableReproofEvidence(
  value: unknown,
  capturedAt: number,
  expectedKind: "screenshot" | "snapshot",
): AuthoringEvidence | undefined {
  const evidence = objectValue(value);
  if (!evidence) return undefined;
  const { id, kind, capturedAt: evidenceCapturedAt, uri, sha256, bytes, mime } = evidence;
  const uriSha256 =
    typeof uri === "string" ? uri.match(/^relay-evidence:\/\/([a-f0-9]{64})$/u)?.[1] : undefined;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    kind !== expectedKind ||
    typeof uri !== "string" ||
    !uriSha256 ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(sha256) ||
    sha256 !== uriSha256 ||
    evidenceCapturedAt !== capturedAt ||
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    typeof mime !== "string" ||
    mime !== (expectedKind === "screenshot" ? "image/png" : "application/json")
  ) {
    return undefined;
  }
  return { id, kind: expectedKind, capturedAt, uri, sha256, bytes, mime };
}

type HumanInterventionReproofEvidenceSet = {
  before: AuthoringEvidence;
  semantics: AuthoringEvidence;
  after: AuthoringEvidence;
  manifest: AuthoringEvidence;
};

function evidenceSetFromPixelBracket(
  observation: unknown,
): HumanInterventionReproofEvidenceSet | undefined {
  const value = objectValue(observation);
  const bracket = objectValue(value?.pixelBracket);
  const before = objectValue(bracket?.before);
  const after = objectValue(bracket?.after);
  const evidence = objectValue(bracket?.evidence);
  const capturedAt = value?.capturedAt;
  const beforeCapturedAt = before?.capturedAt;
  const afterCapturedAt = after?.capturedAt;
  const beforeFingerprint = before?.visualFingerprint;
  const afterFingerprint = after?.visualFingerprint;
  const beforeRasterDigest = before?.rasterDigest;
  const afterRasterDigest = after?.rasterDigest;
  if (
    !bracket ||
    !before ||
    !after ||
    !evidence ||
    bracket.schemaVersion !== 1 ||
    bracket.captureOrder !== "pixels-ax-pixels" ||
    typeof bracket.serial !== "string" ||
    !bracket.serial.trim() ||
    typeof capturedAt !== "number" ||
    !Number.isFinite(capturedAt) ||
    typeof beforeCapturedAt !== "number" ||
    !Number.isFinite(beforeCapturedAt) ||
    typeof afterCapturedAt !== "number" ||
    !Number.isFinite(afterCapturedAt) ||
    typeof beforeFingerprint !== "string" ||
    !beforeFingerprint.trim() ||
    typeof afterFingerprint !== "string" ||
    !afterFingerprint.trim() ||
    typeof beforeRasterDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(beforeRasterDigest) ||
    typeof afterRasterDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(afterRasterDigest) ||
    beforeFingerprint !== afterFingerprint ||
    beforeRasterDigest !== afterRasterDigest ||
    beforeCapturedAt > capturedAt ||
    capturedAt > afterCapturedAt
  ) {
    return undefined;
  }
  const refs = {
    before: durableReproofEvidence(evidence.before, beforeCapturedAt, "screenshot"),
    semantics: durableReproofEvidence(evidence.semantics, capturedAt, "snapshot"),
    after: durableReproofEvidence(evidence.after, afterCapturedAt, "screenshot"),
    manifest: durableReproofEvidence(evidence.manifest, afterCapturedAt, "snapshot"),
  };
  if (!refs.before || !refs.semantics || !refs.after || !refs.manifest) return undefined;
  return {
    before: refs.before,
    semantics: refs.semantics,
    after: refs.after,
    manifest: refs.manifest,
  };
}

/** Resolve only content-addressed evidence explicitly bound to a qualified
 * reproof artifact. Callers must still prove job/run ownership before using
 * the returned metadata to read the blob. */
export function findHumanInterventionReproofEvidence(
  artifacts: readonly { kind?: unknown; data?: unknown }[],
  sha256: string,
): AuthoringEvidence | undefined {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) return undefined;
  for (const artifact of artifacts) {
    if (artifact.kind !== "human-intervention-reproof") continue;
    const observation = objectValue(artifact.data)?.observation;
    const evidence = evidenceSetFromPixelBracket(observation);
    const matched = evidence && Object.values(evidence).find((item) => item.sha256 === sha256);
    if (matched) return structuredClone(matched);
  }
  return undefined;
}

/** iOS AX can complete after its pixels have advanced. The live-capture helper
 * validates the raw rasters; this durable artifact check prevents internal
 * callers from bypassing the required proof shape. */
function hasQualifiedIosPixelBracket(
  job: TestJob,
  requestCapturedAt: number,
  observation: unknown,
): boolean {
  if (job.targetContext?.kind !== "device" || job.targetContext.platform !== "ios") return true;
  const value = objectValue(observation);
  const bracket = objectValue(value?.pixelBracket);
  const evidence = evidenceSetFromPixelBracket(observation);
  if (!bracket || bracket.serial !== job.targetContext.serial || !evidence) {
    return false;
  }
  return (
    evidence.before.capturedAt >= requestCapturedAt &&
    evidence.before.capturedAt <= evidence.semantics.capturedAt &&
    evidence.semantics.capturedAt <= evidence.after.capturedAt
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
  const capturedAt = objectValue(observation)?.capturedAt;
  if (typeof capturedAt !== "number" || capturedAt < owned.requestCapturedAt) {
    throw new HumanInterventionReproofUnavailableError(
      "Resume requires evidence captured after the human intervention request.",
    );
  }
  if (!hasQualifiedIosPixelBracket(job, owned.requestCapturedAt, observation)) {
    throw new HumanInterventionReproofUnavailableError(
      "Resume on iOS requires coherent screenshot evidence captured around the fresh accessibility proof.",
    );
  }
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
