import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  DurableWorkflowAuditEvent,
  DurableWorkflowKind,
  DurableWorkflowRecord,
  DurableWorkflowResourceRef,
  DurableWorkflowResolution,
  DurableWorkflowStatus,
  WorkflowJsonValue,
} from "@relay/protocol";
import { readControlStore, withControlStore, type ControlStore } from "./collaboration-store.js";
import { publish } from "./events.js";

const MAX_ID_LENGTH = 256;
const MAX_TRANSITION_LENGTH = 128;
const MAX_IDENTITY_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 20;
const MAX_WORKFLOW_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export type WorkflowScope = { organizationId: string; projectId: string };

export type CreateDurableWorkflowInput = WorkflowScope & {
  workflowId?: string;
  kind: DurableWorkflowKind;
  frozenIdentity: WorkflowJsonValue;
  resource?: DurableWorkflowResourceRef;
  actorId: string;
  at: number;
  expiresAt: number;
  transition?: string;
  adoptedLegacyRefDigest?: string;
};

export type TransitionDurableWorkflowInput = WorkflowScope & {
  workflowId: string;
  expectedVersion: number;
  actorId: string;
  transition: string;
  status: Exclude<DurableWorkflowStatus, "expired">;
  resource?: DurableWorkflowResourceRef;
  /** Server-derived refinement after canonical resource reconciliation. */
  frozenIdentity?: WorkflowJsonValue;
  resolution?: DurableWorkflowResolution;
  at: number;
};

export type DurableWorkflowRead = {
  record: DurableWorkflowRecord;
  audit: readonly DurableWorkflowAuditEvent[];
};

export type LegacyWorkflowAdoption = {
  kind: DurableWorkflowKind;
  frozenIdentity: WorkflowJsonValue;
  resource: DurableWorkflowResourceRef;
  digest: string;
  repeatIdentity?: {
    pilotJobId: string;
    selectedCaseIds: string[];
  };
};

export type DurableWorkflowTransitionResult =
  | { status: "updated"; workflow: DurableWorkflowRead }
  | { status: "missing" }
  | { status: "stale"; current: DurableWorkflowRead }
  | { status: "expired"; current: DurableWorkflowRead }
  | { status: "terminal"; current: DurableWorkflowRead };

function validId(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isWorkflowJson(value: unknown, depth = 0): value is WorkflowJsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isWorkflowJson(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value).every(
    ([key, item]) => validId(key) && isWorkflowJson(item, depth + 1),
  );
}

function cloneIdentity(value: WorkflowJsonValue): WorkflowJsonValue {
  return JSON.parse(JSON.stringify(value)) as WorkflowJsonValue;
}

function validateFrozenIdentity(value: WorkflowJsonValue): WorkflowJsonValue {
  if (!isWorkflowJson(value)) {
    throw new TypeError("Workflow frozen identity must be bounded JSON");
  }
  const frozenIdentity = cloneIdentity(value);
  if (Buffer.byteLength(JSON.stringify(frozenIdentity), "utf8") > MAX_IDENTITY_BYTES) {
    throw new TypeError("Workflow frozen identity exceeds the size limit");
  }
  return frozenIdentity;
}

function validateResource(resource: DurableWorkflowResourceRef | undefined): void {
  if (resource && !validId(resource.id)) throw new TypeError("Workflow resource id is invalid");
}

function validateScope(scope: WorkflowScope): void {
  if (!validId(scope.organizationId) || !validId(scope.projectId)) {
    throw new TypeError("Workflow scope is invalid");
  }
}

function validateActor(actorId: string): void {
  if (!validId(actorId)) throw new TypeError("Workflow actor is invalid");
}

function validateTransition(transition: string): void {
  if (!validId(transition) || transition.length > MAX_TRANSITION_LENGTH) {
    throw new TypeError("Workflow transition is invalid");
  }
}

function inScope(record: DurableWorkflowRecord, scope: WorkflowScope): boolean {
  return record.organizationId === scope.organizationId && record.projectId === scope.projectId;
}

function readFromStore(
  store: ControlStore,
  scope: WorkflowScope,
  workflowId: string,
): DurableWorkflowRead | undefined {
  const record = store.workflowRecord(workflowId);
  if (!record || !inScope(record, scope)) return undefined;
  return { record, audit: store.workflowRecordEvents(workflowId) };
}

function publishWorkflowChanged(record: DurableWorkflowRecord): void {
  publish(
    {
      type: "workflow.changed",
      at: record.updatedAt,
      workflowId: record.workflowId,
      version: record.version,
      status: record.status,
    },
    { organizationId: record.organizationId, projectId: record.projectId },
  );
}

export async function createDurableWorkflow(
  input: CreateDurableWorkflowInput,
): Promise<
  | { status: "created"; workflow: DurableWorkflowRead }
  | { status: "exists"; workflow: DurableWorkflowRead }
  | { status: "conflict"; current: DurableWorkflowRead }
> {
  validateScope(input);
  validateActor(input.actorId);
  validateResource(input.resource);
  if (!validTime(input.at) || !validTime(input.expiresAt)) {
    throw new TypeError("Workflow timestamps are invalid");
  }
  if (input.expiresAt <= input.at || input.expiresAt - input.at > MAX_WORKFLOW_LIFETIME_MS) {
    throw new TypeError("Workflow expiry is outside the supported lifetime");
  }
  const frozenIdentity = validateFrozenIdentity(input.frozenIdentity);
  const workflowId = input.workflowId ?? randomUUID();
  if (!validId(workflowId)) throw new TypeError("Workflow id is invalid");
  if (input.adoptedLegacyRefDigest && !validId(input.adoptedLegacyRefDigest)) {
    throw new TypeError("Legacy workflow digest is invalid");
  }
  const transition = input.transition ?? "created";
  validateTransition(transition);
  const record: DurableWorkflowRecord = {
    schemaVersion: 1,
    workflowId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    kind: input.kind,
    version: 1,
    status: "active",
    frozenIdentity,
    creationIdentity: frozenIdentity,
    creationResource: input.resource ?? null,
    ...(input.resource ? { resource: input.resource } : {}),
    createdBy: input.actorId,
    lastActorId: input.actorId,
    createdAt: input.at,
    updatedAt: input.at,
    expiresAt: input.expiresAt,
    lastTransition: transition,
    ...(input.adoptedLegacyRefDigest
      ? { adoptedLegacyRefDigest: input.adoptedLegacyRefDigest }
      : {}),
  };
  const event: DurableWorkflowAuditEvent = {
    schemaVersion: 1,
    workflowId,
    sequence: 1,
    version: 1,
    actorId: input.actorId,
    transition,
    status: record.status,
    ...(record.resource ? { resource: record.resource } : {}),
    at: input.at,
  };
  return withControlStore((store) => {
    if (store.insertWorkflowRecord(record, event)) {
      // withControlStore defers dispatch until after the transaction commits.
      // Publishing here therefore cannot announce an uncommitted identity.
      publishWorkflowChanged(record);
      return { status: "created", workflow: { record, audit: [event] } } as const;
    }
    const existing = readFromStore(store, input, workflowId);
    if (!existing) throw new Error("Workflow id already belongs to another project");
    if (
      existing.record.kind !== record.kind ||
      !isDeepStrictEqual(
        existing.record.creationIdentity ?? existing.record.frozenIdentity,
        record.creationIdentity,
      ) ||
      !isDeepStrictEqual(
        existing.record.creationResource === undefined
          ? (existing.record.resource ?? null)
          : existing.record.creationResource,
        record.creationResource,
      ) ||
      existing.record.adoptedLegacyRefDigest !== record.adoptedLegacyRefDigest
    ) {
      return { status: "conflict", current: existing } as const;
    }
    return { status: "exists", workflow: existing } as const;
  });
}

/** Decode the bounded v1 carrier only at the migration seam. The caller may
 * persist the digest and parsed identity, but never the raw reference. */
export function parseLegacyWorkflowAdoption(ref: string): LegacyWorkflowAdoption | undefined {
  const prefix = "relay-workflow.v1.";
  if (!ref.startsWith(prefix) || ref.length > 96 * 1024) return undefined;
  try {
    const encoded = ref.slice(prefix.length).replaceAll("-", "+").replaceAll("_", "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64");
    if (decoded.byteLength > 64 * 1024) return undefined;
    const value = JSON.parse(decoded.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1 || !isWorkflowJson(record.frozen)) return undefined;
    let kind: DurableWorkflowKind;
    let resource: DurableWorkflowResourceRef;
    if (record.kind === "run-test" && validId(String(record.jobId ?? ""))) {
      kind = "run-test";
      resource = { kind: "job", id: String(record.jobId) };
    } else if (record.kind === "author-test" && validId(String(record.sessionId ?? ""))) {
      kind = "author-test";
      resource = { kind: "authoring-session", id: String(record.sessionId) };
    } else if (
      record.kind === "repeat-test" &&
      validId(String(record.repeatId ?? "")) &&
      validId(String(record.pilotJobId ?? "")) &&
      Array.isArray(record.selectedCaseIds) &&
      record.selectedCaseIds.length > 0 &&
      record.selectedCaseIds.length <= 10_000 &&
      record.selectedCaseIds.every(
        (candidate): candidate is string => typeof candidate === "string" && validId(candidate),
      ) &&
      new Set(record.selectedCaseIds).size === record.selectedCaseIds.length
    ) {
      kind = "repeat-test";
      resource = { kind: "campaign", id: String(record.repeatId) };
    } else {
      return undefined;
    }
    const repeatIdentity =
      kind === "repeat-test"
        ? {
            pilotJobId: String(record.pilotJobId),
            selectedCaseIds: [...(record.selectedCaseIds as string[])],
          }
        : undefined;
    return {
      kind,
      frozenIdentity: cloneIdentity(record.frozen),
      resource,
      digest: `sha256:${createHash("sha256").update(ref, "utf8").digest("hex")}`,
      ...(repeatIdentity ? { repeatIdentity } : {}),
    };
  } catch {
    return undefined;
  }
}

export async function readDurableWorkflow(
  scope: WorkflowScope & { workflowId: string },
): Promise<DurableWorkflowRead | undefined> {
  validateScope(scope);
  if (!validId(scope.workflowId)) throw new TypeError("Workflow id is invalid");
  return readControlStore((store) => readFromStore(store, scope, scope.workflowId));
}

/** Resolve a durable workflow from its server-owned resource reference. This
 * supports restoring persisted runs whose summaries predate workflowId. */
export async function findDurableWorkflowByResource(input: {
  organizationId: string;
  projectId: string;
  workflowKind: DurableWorkflowRecord["kind"];
  resourceKind: DurableWorkflowResourceRef["kind"];
  resourceId: string;
}): Promise<DurableWorkflowRead | undefined> {
  validateScope(input);
  if (!validId(input.resourceId)) throw new TypeError("Workflow resource id is invalid");
  return readControlStore((store) => {
    const record = store
      .workflowRecordsByResource(
        input.organizationId,
        input.projectId,
        input.workflowKind,
        input.resourceKind,
        input.resourceId,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return record ? { record, audit: store.workflowRecordEvents(record.workflowId) } : undefined;
  });
}

export async function findDurableWorkflowsByResources(input: {
  organizationId: string;
  projectId: string;
  workflowKind: DurableWorkflowRecord["kind"];
  resourceKind: DurableWorkflowResourceRef["kind"];
  resourceIds: readonly string[];
}): Promise<ReadonlyMap<string, DurableWorkflowRead>> {
  validateScope(input);
  const resourceIds = [...new Set(input.resourceIds.filter((id) => validId(id)))];
  if (!resourceIds.length) return new Map();
  return readControlStore((store) => {
    const result = new Map<string, DurableWorkflowRead>();
    for (const record of store.workflowRecordsByResources(
      input.organizationId,
      input.projectId,
      input.workflowKind,
      input.resourceKind,
      resourceIds,
    )) {
      const resourceId = record.resource?.id;
      if (!resourceId) continue;
      const current = result.get(resourceId);
      if (!current || current.record.updatedAt < record.updatedAt) {
        result.set(resourceId, { record, audit: store.workflowRecordEvents(record.workflowId) });
      }
    }
    return result;
  });
}

export async function transitionDurableWorkflow(
  input: TransitionDurableWorkflowInput,
): Promise<DurableWorkflowTransitionResult> {
  validateScope(input);
  validateActor(input.actorId);
  validateTransition(input.transition);
  validateResource(input.resource);
  const frozenIdentity =
    input.frozenIdentity === undefined ? undefined : validateFrozenIdentity(input.frozenIdentity);
  if (!validId(input.workflowId) || !Number.isSafeInteger(input.expectedVersion)) {
    throw new TypeError("Workflow identity or expected version is invalid");
  }
  if (!validTime(input.at)) throw new TypeError("Workflow transition time is invalid");
  if (
    input.resolution &&
    (input.resolution.kind !== "abandoned" ||
      !input.resolution.reason.trim() ||
      input.resolution.reason.length > 1_000 ||
      !validTime(input.resolution.at))
  ) {
    throw new TypeError("Workflow resolution is invalid");
  }
  return withControlStore((store) => {
    const current = readFromStore(store, input, input.workflowId);
    if (!current) return { status: "missing" } as const;
    const recoveringFailedAuthoring =
      current.record.kind === "author-test" &&
      current.record.lastTransition === "authoring-failed" &&
      input.transition === "authoring-review-recovered" &&
      input.status === "active" &&
      current.record.resource?.kind === "authoring-session" &&
      input.resource?.kind === "authoring-session" &&
      input.resource.id === current.record.resource.id;
    if (current.record.status === "terminal" && !recoveringFailedAuthoring)
      return { status: "terminal", current } as const;
    if (current.record.status === "expired") return { status: "expired", current } as const;
    if (current.record.expiresAt <= input.at) {
      const version = current.record.version + 1;
      const record: DurableWorkflowRecord = {
        ...current.record,
        version,
        status: "expired",
        lastActorId: input.actorId,
        lastTransition: "expired",
        updatedAt: input.at,
      };
      const event: DurableWorkflowAuditEvent = {
        schemaVersion: 1,
        workflowId: record.workflowId,
        sequence: version,
        version,
        actorId: input.actorId,
        transition: "expired",
        status: "expired",
        ...(record.resource ? { resource: record.resource } : {}),
        at: input.at,
      };
      const result = store.compareAndSetWorkflowRecord(current.record.version, record, event);
      if (result === "updated") publishWorkflowChanged(record);
      return {
        status: "expired",
        current: readFromStore(store, input, input.workflowId) ?? current,
      } as const;
    }
    if (current.record.version !== input.expectedVersion) {
      return { status: "stale", current } as const;
    }
    const version = current.record.version + 1;
    const record: DurableWorkflowRecord = {
      ...current.record,
      version,
      status: input.status,
      ...(input.resource ? { resource: input.resource } : {}),
      ...(frozenIdentity !== undefined ? { frozenIdentity } : {}),
      ...(input.resolution ? { resolution: structuredClone(input.resolution) } : {}),
      lastActorId: input.actorId,
      lastTransition: input.transition,
      updatedAt: input.at,
    };
    const event: DurableWorkflowAuditEvent = {
      schemaVersion: 1,
      workflowId: record.workflowId,
      sequence: version,
      version,
      actorId: input.actorId,
      transition: input.transition,
      status: input.status,
      ...(record.resource ? { resource: record.resource } : {}),
      ...(input.resolution ? { resolution: structuredClone(input.resolution) } : {}),
      at: input.at,
    };
    const result = store.compareAndSetWorkflowRecord(input.expectedVersion, record, event);
    if (result !== "updated") {
      const latest = readFromStore(store, input, input.workflowId);
      if (!latest) return { status: "missing" } as const;
      return { status: "stale", current: latest } as const;
    }
    publishWorkflowChanged(record);
    return {
      status: "updated",
      workflow: { record, audit: [...current.audit, event] },
    } as const;
  });
}
