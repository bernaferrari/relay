import { parseActorIdentity, type ActorKind, type OperationScope } from "./coordination.js";

/** Durable, payload-safe operation history shared by people, agents, and hosts. */
export type ActivityRecord = OperationScope & {
  schemaVersion: 1;
  activityId: string;
  actorId: string;
  actorKind: ActorKind;
  operationId: string;
  requestId: string;
  timestamp: number;
  eventType: string;
  resourceKind: string;
  resourceId: string;
  summary: string;
  correlationId?: string;
  causationId?: string;
  sessionId?: string;
  leaseId?: string;
  beforeRevision?: number;
  afterRevision?: number;
  evidenceIds?: string[];
  outcome?: "succeeded" | "failed" | "cancelled";
  durationMs?: number;
  statusCode?: number;
  errorCode?: string;
};

export type ActivityExport = {
  manifest: {
    schemaVersion: 1;
    generatedAt: number;
    organizationId: string;
    projectId: string;
    recordCount: number;
    firstTimestamp?: number;
    lastTimestamp?: number;
    /** SHA-256 of chronological UTF-8 NDJSON records, including the final newline. */
    sha256: string;
  };
  /** Chronological, project-scoped records. */
  records: ActivityRecord[];
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function optionalActivityFields(input: Record<string, unknown>) {
  const fields = {
    correlationId: optionalString(input.correlationId, "activity correlationId"),
    causationId: optionalString(input.causationId, "activity causationId"),
    sessionId: optionalString(input.sessionId, "activity sessionId"),
    leaseId: optionalString(input.leaseId, "activity leaseId"),
    errorCode: optionalString(input.errorCode, "activity errorCode"),
  };
  return Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined)) as {
    correlationId?: string;
    causationId?: string;
    sessionId?: string;
    leaseId?: string;
    errorCode?: string;
  };
}

function activityRecord(value: unknown, scope: OperationScope): ActivityRecord {
  const input = object(value, "activity record");
  if (input.schemaVersion !== 1) throw new TypeError("activity record schemaVersion must be 1");
  const actor = parseActorIdentity(input);
  const organizationId = requiredString(input.organizationId, "activity organizationId");
  const projectId = requiredString(input.projectId, "activity projectId");
  if (organizationId !== scope.organizationId || projectId !== scope.projectId) {
    throw new TypeError("activity record scope must match its export manifest");
  }
  const outcome = optionalString(input.outcome, "activity outcome");
  if (outcome && outcome !== "succeeded" && outcome !== "failed" && outcome !== "cancelled") {
    throw new TypeError("activity outcome must be succeeded, failed, or cancelled");
  }
  const evidenceIds = input.evidenceIds;
  if (
    evidenceIds !== undefined &&
    (!Array.isArray(evidenceIds) ||
      evidenceIds.some((item) => typeof item !== "string" || !item.trim()))
  ) {
    throw new TypeError("activity evidenceIds must be non-empty strings");
  }
  const statusCode =
    input.statusCode === undefined
      ? undefined
      : nonNegativeInteger(input.statusCode, "activity statusCode");
  if (statusCode !== undefined && (statusCode < 100 || statusCode > 599)) {
    throw new TypeError("activity statusCode must be between 100 and 599");
  }
  return {
    schemaVersion: 1,
    organizationId,
    projectId,
    ...actor,
    activityId: requiredString(input.activityId, "activityId"),
    operationId: requiredString(input.operationId, "activity operationId"),
    requestId: requiredString(input.requestId, "activity requestId"),
    timestamp: nonNegativeInteger(input.timestamp, "activity timestamp"),
    eventType: requiredString(input.eventType, "activity eventType"),
    resourceKind: requiredString(input.resourceKind, "activity resourceKind"),
    resourceId: requiredString(input.resourceId, "activity resourceId"),
    summary: requiredString(input.summary, "activity summary"),
    ...optionalActivityFields(input),
    ...(evidenceIds ? { evidenceIds: [...evidenceIds] as string[] } : {}),
    ...(outcome ? { outcome: outcome as ActivityRecord["outcome"] } : {}),
    ...(input.beforeRevision !== undefined
      ? { beforeRevision: nonNegativeInteger(input.beforeRevision, "activity beforeRevision") }
      : {}),
    ...(input.afterRevision !== undefined
      ? { afterRevision: nonNegativeInteger(input.afterRevision, "activity afterRevision") }
      : {}),
    ...(input.durationMs !== undefined
      ? { durationMs: nonNegativeInteger(input.durationMs, "activity durationMs") }
      : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
}

/** Runtime boundary for server, CLI, and desktop audit downloads. */
export function parseActivityExportResponse(value: unknown): { export: ActivityExport } {
  const response = object(value, "activity export response");
  const exported = object(response.export, "activity export");
  const manifest = object(exported.manifest, "activity export manifest");
  if (manifest.schemaVersion !== 1) throw new TypeError("activity export schemaVersion must be 1");
  const organizationId = requiredString(manifest.organizationId, "activity export organizationId");
  const projectId = requiredString(manifest.projectId, "activity export projectId");
  const scope = { organizationId, projectId };
  if (!Array.isArray(exported.records)) {
    throw new TypeError("activity export records must be an array");
  }
  const records = exported.records.map((record) => activityRecord(record, scope));
  const recordCount = nonNegativeInteger(manifest.recordCount, "activity export recordCount");
  if (recordCount !== records.length) {
    throw new TypeError("activity export recordCount must match records");
  }
  const sha256 = requiredString(manifest.sha256, "activity export sha256");
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new TypeError("activity export sha256 must be lowercase hex");
  }
  return {
    export: {
      manifest: {
        schemaVersion: 1,
        generatedAt: nonNegativeInteger(manifest.generatedAt, "activity export generatedAt"),
        organizationId,
        projectId,
        recordCount,
        ...(manifest.firstTimestamp !== undefined
          ? {
              firstTimestamp: nonNegativeInteger(
                manifest.firstTimestamp,
                "activity export firstTimestamp",
              ),
            }
          : {}),
        ...(manifest.lastTimestamp !== undefined
          ? {
              lastTimestamp: nonNegativeInteger(
                manifest.lastTimestamp,
                "activity export lastTimestamp",
              ),
            }
          : {}),
        sha256,
      },
      records,
    },
  };
}
