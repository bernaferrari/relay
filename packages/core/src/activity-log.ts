import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActorKind } from "@relay/protocol";
import { KeyedSerialQueue } from "./coordination-store.js";
import {
  currentOperationContext,
  requireOperationContext,
  type OperationContext,
} from "./operation-context.js";
import { findWorkspaceRoot } from "./workspace-root.js";

export const MAX_ACTIVITY_PAGE_SIZE = 100;
const DEFAULT_ACTIVITY_PAGE_SIZE = 50;
const MAX_SUMMARY_LENGTH = 240;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_EVIDENCE_IDS = 100;

export type ActivityScope = {
  organizationId: string;
  projectId: string;
};

export type ActivityRecord = ActivityScope & {
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
  /** Terminal operation outcome. Requested events intentionally omit it. */
  outcome?: "succeeded" | "failed" | "cancelled";
  /** Wall-clock duration from request acceptance to response completion. */
  durationMs?: number;
  /** HTTP is a transport detail, but its bounded status is safe and useful evidence. */
  statusCode?: number;
  /** Stable, non-sensitive recovery key such as HTTP_422 or CLIENT_DISCONNECTED. */
  errorCode?: string;
};

export type AppendActivityInput = {
  eventType: string;
  resourceKind: string;
  resourceId: string;
  summary: string;
  timestamp?: number;
  beforeRevision?: number;
  afterRevision?: number;
  evidenceIds?: readonly string[];
  outcome?: ActivityRecord["outcome"];
  durationMs?: number;
  statusCode?: number;
  errorCode?: string;
};

export type ListActivityInput = Partial<ActivityScope> & {
  limit?: number;
  cursor?: string;
};

export type ActivityPage = {
  items: ActivityRecord[];
  nextCursor?: string;
};

export class ActivityCursorError extends Error {
  readonly status = 400;

  constructor(message = "Activity cursor is invalid or no longer available") {
    super(message);
    this.name = "ActivityCursorError";
  }
}

export type ActivityLogOptions = {
  rootDirectory?: string;
  maxPageSize?: number;
  defaultPageSize?: number;
};

function relayStateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function boundedText(value: string, label: string, max = MAX_IDENTIFIER_LENGTH): string {
  if (value.length > max) throw new TypeError(`${label} is too long`);
  const normalized = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("")
    .trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function revision(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function scopeFrom(input: Partial<ActivityScope>): ActivityScope {
  const context = currentOperationContext();
  const organizationId = input.organizationId ?? context?.organizationId;
  const projectId = input.projectId ?? context?.projectId;
  if (!organizationId || !projectId) {
    throw new Error("Relay operation context or an explicit Activity scope is required");
  }
  return {
    organizationId: boundedText(organizationId, "organizationId"),
    projectId: boundedText(projectId, "projectId"),
  };
}

function scopeFileName(scope: ActivityScope): string {
  const organization = Buffer.from(scope.organizationId, "utf8").toString("base64url");
  const project = Buffer.from(scope.projectId, "utf8").toString("base64url");
  return `${organization}.${project}.jsonl`;
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : boundedText(String(value), label);
}

function isOptionalStoredText(value: unknown): boolean {
  return value === undefined || isStoredText(value);
}

function isStoredText(value: unknown, max = MAX_IDENTIFIER_LENGTH): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseActivityRecord(value: unknown, scope: ActivityScope): ActivityRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<ActivityRecord>;
  if (
    input.schemaVersion !== 1 ||
    input.organizationId !== scope.organizationId ||
    input.projectId !== scope.projectId ||
    !isStoredText(input.activityId) ||
    !/^[0-9a-f-]{36}$/.test(input.activityId) ||
    !isStoredText(input.actorId) ||
    (input.actorKind !== "human" && input.actorKind !== "agent" && input.actorKind !== "system") ||
    !isStoredText(input.operationId) ||
    !isStoredText(input.requestId) ||
    typeof input.timestamp !== "number" ||
    !Number.isFinite(input.timestamp) ||
    input.timestamp < 0 ||
    !isStoredText(input.eventType) ||
    !isStoredText(input.resourceKind) ||
    !isStoredText(input.resourceId) ||
    !isStoredText(input.summary, MAX_SUMMARY_LENGTH) ||
    !isOptionalStoredText(input.correlationId) ||
    !isOptionalStoredText(input.causationId) ||
    !isOptionalStoredText(input.sessionId) ||
    !isOptionalStoredText(input.leaseId) ||
    (input.beforeRevision !== undefined &&
      (!Number.isSafeInteger(input.beforeRevision) || input.beforeRevision < 0)) ||
    (input.afterRevision !== undefined &&
      (!Number.isSafeInteger(input.afterRevision) || input.afterRevision < 0)) ||
    (input.evidenceIds !== undefined &&
      (!Array.isArray(input.evidenceIds) ||
        input.evidenceIds.length > MAX_EVIDENCE_IDS ||
        input.evidenceIds.some((item) => !isStoredText(item)))) ||
    (input.outcome !== undefined &&
      input.outcome !== "succeeded" &&
      input.outcome !== "failed" &&
      input.outcome !== "cancelled") ||
    (input.durationMs !== undefined &&
      (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0)) ||
    (input.statusCode !== undefined &&
      (!Number.isSafeInteger(input.statusCode) ||
        input.statusCode < 100 ||
        input.statusCode > 599)) ||
    !isOptionalStoredText(input.errorCode)
  ) {
    return null;
  }
  return input as ActivityRecord;
}

function encodeCursor(activityId: string): string {
  return Buffer.from(activityId, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 128) throw new ActivityCursorError();
  const activityId = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^[0-9a-f-]{36}$/.test(activityId)) throw new ActivityCursorError();
  return activityId;
}

/**
 * Append-only semantic history. Its deliberately narrow record shape prevents
 * callers from persisting request bodies, arbitrary payloads, or credentials.
 */
export class ActivityLog {
  readonly #options: ActivityLogOptions;
  readonly #writes = new KeyedSerialQueue();

  constructor(options: ActivityLogOptions = {}) {
    this.#options = options;
  }

  #directory(): string {
    return join(this.#options.rootDirectory ?? relayStateRoot(), "activity");
  }

  #path(scope: ActivityScope): string {
    return join(this.#directory(), scopeFileName(scope));
  }

  async append(
    input: AppendActivityInput,
    operation: OperationContext = requireOperationContext(),
  ): Promise<ActivityRecord> {
    const scope = scopeFrom(operation);
    const evidenceIds = input.evidenceIds
      ? [...new Set(input.evidenceIds.map((id) => boundedText(id, "evidenceId")))].slice(
          0,
          MAX_EVIDENCE_IDS,
        )
      : undefined;
    const correlationId = optionalText(operation.correlationId, "correlationId");
    const causationId = optionalText(operation.causationId, "causationId");
    const sessionId = optionalText(operation.authoringSessionId, "sessionId");
    const leaseId = optionalText(operation.leaseId, "leaseId");
    const beforeRevision = revision(input.beforeRevision, "beforeRevision");
    const afterRevision = revision(input.afterRevision, "afterRevision");
    const durationMs = nonNegativeInteger(input.durationMs, "durationMs");
    const statusCode = nonNegativeInteger(input.statusCode, "statusCode");
    if (statusCode !== undefined && (statusCode < 100 || statusCode > 599)) {
      throw new TypeError("statusCode must be between 100 and 599");
    }
    const errorCode = optionalText(input.errorCode, "errorCode");
    const record: ActivityRecord = {
      schemaVersion: 1,
      activityId: randomUUID(),
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      actorId: boundedText(operation.actorId, "actorId"),
      actorKind: operation.actorKind,
      operationId: boundedText(operation.operationId, "operationId"),
      requestId: boundedText(operation.requestId, "requestId"),
      timestamp: input.timestamp ?? Date.now(),
      eventType: boundedText(input.eventType, "eventType"),
      resourceKind: boundedText(input.resourceKind, "resourceKind"),
      resourceId: boundedText(input.resourceId, "resourceId"),
      summary: boundedText(input.summary, "summary", MAX_SUMMARY_LENGTH),
      ...(correlationId ? { correlationId } : {}),
      ...(causationId ? { causationId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(leaseId ? { leaseId } : {}),
      ...(beforeRevision !== undefined ? { beforeRevision } : {}),
      ...(afterRevision !== undefined ? { afterRevision } : {}),
      ...(evidenceIds?.length ? { evidenceIds } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(errorCode ? { errorCode } : {}),
    };
    if (!Number.isFinite(record.timestamp) || record.timestamp < 0) {
      throw new TypeError("timestamp must be a non-negative finite number");
    }

    const path = this.#path(scope);
    await this.#writes.run(path, async () => {
      await mkdir(this.#directory(), { recursive: true, mode: 0o700 });
      const file = await open(path, "a", 0o600);
      try {
        await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
    });
    return structuredClone(record);
  }

  async list(input: ListActivityInput = {}): Promise<ActivityPage> {
    const scope = scopeFrom(input);
    const maxPageSize = Math.max(
      1,
      Math.min(this.#options.maxPageSize ?? MAX_ACTIVITY_PAGE_SIZE, MAX_ACTIVITY_PAGE_SIZE),
    );
    const defaultPageSize = Math.max(
      1,
      Math.min(this.#options.defaultPageSize ?? DEFAULT_ACTIVITY_PAGE_SIZE, maxPageSize),
    );
    const requested = input.limit ?? defaultPageSize;
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(Math.floor(requested), maxPageSize))
      : defaultPageSize;

    let contents: string;
    try {
      contents = await readFile(this.#path(scope), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { items: [] };
      }
      throw error;
    }
    const records = contents
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          const record = parseActivityRecord(JSON.parse(line) as unknown, scope);
          return record ? [record] : [];
        } catch {
          // A crash may leave a partial trailing write. Valid preceding records
          // remain readable, and isolated malformed records never poison history.
          return [];
        }
      })
      .reverse();

    let start = 0;
    if (input.cursor) {
      const activityId = decodeCursor(input.cursor);
      const index = records.findIndex((record) => record.activityId === activityId);
      if (index < 0) throw new ActivityCursorError();
      start = index + 1;
    }
    const items = records.slice(start, start + limit);
    const hasMore = start + items.length < records.length;
    return {
      items: structuredClone(items),
      ...(hasMore && items.length
        ? { nextCursor: encodeCursor(items[items.length - 1]!.activityId) }
        : {}),
    };
  }
}

export const activityLog = new ActivityLog();

export function appendActivity(
  input: AppendActivityInput,
  operation?: OperationContext,
): Promise<ActivityRecord> {
  return operation ? activityLog.append(input, operation) : activityLog.append(input);
}

export function listActivity(input: ListActivityInput = {}): Promise<ActivityPage> {
  return activityLog.list(input);
}
