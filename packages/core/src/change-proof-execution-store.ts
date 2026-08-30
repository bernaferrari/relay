import {
  changeProofExecutionCancellationSchema,
  changeProofExecutionCellStatusSchema,
  changeProofExecutionStatusSchema,
  changeProofExecutionUncertaintySchema,
  changeProofCaseResultSchema,
  parseChangeVerification,
} from "@relay/protocol";
import type {
  ChangeProofPublicationRequest,
  ChangeVerificationScope,
} from "./change-verification-store.js";
import { readControlStore, type ControlStore } from "./collaboration-store.js";
import { canonicalSha256 } from "./canonical-json.js";
import type { ChangeProofExecutionUpdateGuard } from "./change-proof-execution-db.js";
import {
  CHANGE_PROOF_EXECUTION_SCHEMA_VERSION,
  ChangeProofExecutionError,
  type ChangeProofExecutionRecord,
} from "./change-proof-execution-types.js";
import type { ChangeProofRunCase } from "./change-proof-live-run.js";

export function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function requestDigest(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error("requestDigest must be a canonical sha256 digest");
  }
  return value as `sha256:${string}`;
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative timestamp`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function positiveOrZero(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`);
  }
  return value;
}

/** Parse and validate a persisted execution before any state transition. */
export function normalizeRecord(value: unknown): ChangeProofExecutionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Change Proof execution document must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== CHANGE_PROOF_EXECUTION_SCHEMA_VERSION) {
    throw new Error("Unsupported Change Proof execution schema version");
  }
  const frozenProof = parseChangeVerification(input.frozenProof);
  const publicationValue = input.publication;
  const publication =
    publicationValue === undefined
      ? undefined
      : (() => {
          if (
            !publicationValue ||
            typeof publicationValue !== "object" ||
            Array.isArray(publicationValue)
          ) {
            throw new Error("Execution publication intent is invalid");
          }
          const candidate = publicationValue as Record<string, unknown>;
          if (candidate.provider !== "github")
            throw new Error("Unsupported execution publication provider");
          if (candidate.detailsUrl !== undefined && typeof candidate.detailsUrl !== "string") {
            throw new Error("Execution publication detailsUrl is invalid");
          }
          if (
            candidate.maxAttempts !== undefined &&
            (typeof candidate.maxAttempts !== "number" ||
              !Number.isSafeInteger(candidate.maxAttempts) ||
              candidate.maxAttempts < 1)
          ) {
            throw new Error("Execution publication maxAttempts is invalid");
          }
          return {
            provider: "github" as const,
            ...(candidate.detailsUrl === undefined ? {} : { detailsUrl: candidate.detailsUrl }),
            ...(candidate.maxAttempts === undefined ? {} : { maxAttempts: candidate.maxAttempts }),
          } satisfies ChangeProofPublicationRequest;
        })();
  const cells = input.cells;
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > 1_000) {
    throw new Error("Change Proof execution cells are invalid");
  }
  const normalizedCells = cells.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Change Proof execution cell ${index} is invalid`);
    }
    const cell = value as Record<string, unknown>;
    const status = changeProofExecutionCellStatusSchema.parse(cell.status);
    const parsedCell = cell.cell;
    if (!parsedCell || typeof parsedCell !== "object" || Array.isArray(parsedCell)) {
      throw new Error(`Change Proof execution cell ${index} has no frozen identity`);
    }
    const candidate = parsedCell as Record<string, unknown>;
    const frozen = {
      cellId: nonEmpty(candidate.cellId, `cells[${index}].cell.cellId`),
      appMapId: nonEmpty(candidate.appMapId, `cells[${index}].cell.appMapId`),
      testId: nonEmpty(candidate.testId, `cells[${index}].cell.testId`),
      appMapRevision: positiveInteger(
        candidate.appMapRevision,
        `cells[${index}].cell.appMapRevision`,
      ),
      targetCaseId: nonEmpty(candidate.targetCaseId, `cells[${index}].cell.targetCaseId`),
      buildId: nonEmpty(candidate.buildId, `cells[${index}].cell.buildId`),
    } satisfies ChangeProofRunCase;
    const result =
      cell.result === undefined ? undefined : changeProofCaseResultSchema.parse(cell.result);
    return {
      cell: frozen,
      status,
      ...(cell.runId === undefined ? {} : { runId: nonEmpty(cell.runId, `cells[${index}].runId`) }),
      ...(result ? { result } : {}),
      updatedAt: timestamp(cell.updatedAt, `cells[${index}].updatedAt`),
    };
  });
  const status = changeProofExecutionStatusSchema.parse(input.status);
  const cursor = positiveOrZero(input.cursor, "cursor");
  const total = positiveInteger(input.total, "total");
  if (total !== normalizedCells.length || cursor > total) {
    throw new Error("Change Proof execution cursor and total are inconsistent");
  }
  const runIds = input.runIds;
  if (!Array.isArray(runIds) || runIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("Change Proof execution Run ids are invalid");
  }
  if (new Set(runIds).size !== runIds.length)
    throw new Error("Change Proof execution Run ids repeat");
  const terminalUncertainty =
    input.terminalUncertainty === undefined
      ? undefined
      : changeProofExecutionUncertaintySchema.parse(input.terminalUncertainty);
  if (status === "uncertain" && !terminalUncertainty) {
    throw new Error("An uncertain Change Proof execution needs terminal uncertainty");
  }
  if (status !== "uncertain" && terminalUncertainty) {
    throw new Error("Terminal uncertainty is only valid on an uncertain execution");
  }
  const cancellation =
    input.cancellation === undefined
      ? undefined
      : changeProofExecutionCancellationSchema.parse(input.cancellation);
  if (status === "cancelled" && !cancellation) {
    throw new Error("A cancelled Change Proof execution needs cancellation provenance");
  }
  if (status !== "cancelled" && cancellation) {
    throw new Error("Cancellation provenance is only valid on a cancelled execution");
  }
  const leaseValue = input.lease;
  const lease =
    leaseValue === undefined
      ? undefined
      : {
          workerId: nonEmpty((leaseValue as Record<string, unknown>).workerId, "lease.workerId"),
          token: nonEmpty((leaseValue as Record<string, unknown>).token, "lease.token"),
          claimedAt: timestamp(
            (leaseValue as Record<string, unknown>).claimedAt,
            "lease.claimedAt",
          ),
          expiresAt: timestamp(
            (leaseValue as Record<string, unknown>).expiresAt,
            "lease.expiresAt",
          ),
        };
  if (lease && lease.expiresAt <= lease.claimedAt) throw new Error("Execution lease is expired");
  return {
    schemaVersion: CHANGE_PROOF_EXECUTION_SCHEMA_VERSION,
    id: nonEmpty(input.id, "id"),
    organizationId: nonEmpty(input.organizationId, "organizationId"),
    projectId: nonEmpty(input.projectId, "projectId"),
    proofId: nonEmpty(input.proofId, "proofId"),
    proofVersion: positiveInteger(input.proofVersion, "proofVersion"),
    requestId: nonEmpty(input.requestId, "requestId"),
    requestDigest: requestDigest(input.requestDigest),
    actorId: nonEmpty(input.actorId, "actorId"),
    authority:
      input.authority === "confirmed"
        ? "confirmed"
        : (() => {
            throw new Error("Execution authority must be confirmed");
          })(),
    ...(publication ? { publication } : {}),
    frozenProof,
    cells: normalizedCells,
    cursor,
    total,
    deadlineAt: timestamp(input.deadlineAt, "deadlineAt"),
    status,
    runIds: [...runIds] as string[],
    ...(cancellation ? { cancellation } : {}),
    ...(terminalUncertainty ? { terminalUncertainty } : {}),
    ...(lease ? { lease } : {}),
    createdAt: timestamp(input.createdAt, "createdAt"),
    updatedAt: timestamp(input.updatedAt, "updatedAt"),
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function executionId(scope: ChangeVerificationScope, proofId: string): string {
  return `proof-execution:${canonicalSha256({ ...scope, proofId }).slice("sha256:".length)}`;
}

export function mutationDigest(
  record: ChangeProofExecutionRecord,
  action: string,
  at: number,
): `sha256:${string}` {
  return canonicalSha256({ executionId: record.id, action, cursor: record.cursor, at });
}

export function updateGuard(record: ChangeProofExecutionRecord): ChangeProofExecutionUpdateGuard {
  return {
    status: record.status,
    cursor: record.cursor,
    ...(record.lease?.token ? { leaseToken: record.lease.token } : {}),
  };
}

export function write(
  store: ControlStore,
  record: ChangeProofExecutionRecord,
  guard?: ChangeProofExecutionUpdateGuard,
): ChangeProofExecutionRecord {
  const normalized = normalizeRecord(record);
  if (!store.updateChangeProofExecution(normalized, guard)) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_NOT_FOUND",
      "Change Proof execution disappeared during update",
    );
  }
  return clone(normalized);
}

export async function readExecution(
  scope: ChangeVerificationScope,
  proofId: string,
): Promise<ChangeProofExecutionRecord | undefined> {
  return readControlStore((store) => {
    const record = store.changeProofExecutionByProof(
      scope.organizationId,
      scope.projectId,
      proofId,
    );
    return record ? normalizeRecord(record) : undefined;
  });
}
