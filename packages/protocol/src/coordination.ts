export const ACTOR_KINDS = ["human", "agent", "system"] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export type ActorIdentity = { actorId: string; actorKind: ActorKind };

export type OperationScope = { organizationId: string; projectId: string };

export type CommandIdentity = ActorIdentity &
  OperationScope & {
    schemaVersion: 1;
    operationId: string;
    requestId: string;
    idempotencyKey: string;
    issuedAt: number;
    causationId?: string;
    correlationId?: string;
    authoringSessionId?: string;
  };

export type CommandEnvelope<T = unknown> = CommandIdentity & { payload: T };

export type EventEnvelope<T = RelayEventPayload> = ActorIdentity &
  OperationScope & {
    schemaVersion: 1;
    eventId: string;
    sequence: number;
    operationId: string;
    requestId: string;
    occurredAt: number;
    causationId?: string;
    correlationId?: string;
    authoringSessionId?: string;
    leaseId?: string;
    payload: T;
  };

export type ResourceKind =
  | "project"
  | "build"
  | "device-pool"
  | "lease"
  | "variables"
  | "app-map"
  | "recipe"
  | "matrix"
  | "recording-session"
  | "discovery-session"
  | "presence";

export type ResourceEventPayload = {
  type: "resource.created" | "resource.updated" | "resource.deleted" | "lease.changed";
  at: number;
  projectId: string;
  resource: ResourceKind;
  resourceId: string;
  revision?: number;
};

export type StreamGapPayload = {
  type: "stream.gap";
  at: number;
  requestedAfter: number;
  oldestAvailable: number;
  latestAvailable: number;
  requiresRefresh: true;
};

/** Bounded notification that one durable workflow record changed. The event
 * deliberately carries no frozen identity, resource payload, or audit body;
 * consumers refresh the canonical workflow through its scoped read API. */
export type WorkflowChangedPayload = {
  type: "workflow.changed";
  at: number;
  workflowId: string;
  version: number;
  status: "active" | "needs-attention" | "terminal" | "expired";
};

export type RelayEventPayload =
  | ResourceEventPayload
  | StreamGapPayload
  | WorkflowChangedPayload
  | ({ type: string; at: number } & Record<string, unknown>);

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
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${label} must be positive`);
  return number;
}

export function parseActorIdentity(value: unknown): ActorIdentity {
  const input = object(value, "actor identity");
  const actorKind = requiredString(input.actorKind, "actorKind");
  if (!ACTOR_KINDS.includes(actorKind as ActorKind)) {
    throw new TypeError("actorKind must be human, agent, or system");
  }
  return { actorId: requiredString(input.actorId, "actorId"), actorKind: actorKind as ActorKind };
}

function optionalIdentity(input: Record<string, unknown>) {
  const causationId = optionalString(input.causationId, "causationId");
  const correlationId = optionalString(input.correlationId, "correlationId");
  const authoringSessionId = optionalString(input.authoringSessionId, "authoringSessionId");
  return {
    ...(causationId ? { causationId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(authoringSessionId ? { authoringSessionId } : {}),
  };
}

export function parseCommandEnvelope<T>(
  value: unknown,
  parsePayload: (payload: unknown) => T,
): CommandEnvelope<T> {
  const input = object(value, "command envelope");
  if (input.schemaVersion !== 1) throw new TypeError("command schemaVersion must be 1");
  return {
    schemaVersion: 1,
    ...parseActorIdentity(input),
    organizationId: requiredString(input.organizationId, "organizationId"),
    projectId: requiredString(input.projectId, "projectId"),
    operationId: requiredString(input.operationId, "operationId"),
    requestId: requiredString(input.requestId, "requestId"),
    idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey"),
    issuedAt: finiteNumber(input.issuedAt, "issuedAt"),
    ...optionalIdentity(input),
    payload: parsePayload(input.payload),
  };
}

export function parseEventEnvelope(value: unknown): EventEnvelope {
  const input = object(value, "event envelope");
  if (input.schemaVersion !== 1) throw new TypeError("event schemaVersion must be 1");
  const payload = object(input.payload, "event payload");
  const leaseId = optionalString(input.leaseId, "leaseId");
  return {
    schemaVersion: 1,
    ...parseActorIdentity(input),
    organizationId: requiredString(input.organizationId, "organizationId"),
    projectId: requiredString(input.projectId, "projectId"),
    eventId: requiredString(input.eventId, "eventId"),
    sequence: positiveInteger(input.sequence, "sequence"),
    operationId: requiredString(input.operationId, "operationId"),
    requestId: requiredString(input.requestId, "requestId"),
    occurredAt: finiteNumber(input.occurredAt, "occurredAt"),
    ...optionalIdentity(input),
    ...(leaseId ? { leaseId } : {}),
    payload: {
      ...payload,
      type: requiredString(payload.type, "event payload type"),
      at: finiteNumber(payload.at, "event payload at"),
    } as RelayEventPayload,
  };
}
