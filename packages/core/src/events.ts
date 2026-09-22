import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import type {
  EventEnvelope,
  RelayEventPayload,
  ResourceEvent,
  StreamGapPayload,
  ProofExecutionChangedPayload,
  WorkflowChangedPayload,
} from "@relay/protocol";
import { currentOperationContext, type OperationContext } from "./operation-context.js";

/**
 * Process-local event bus (OpenCode-style pub/sub for hosts).
 * Server fans this out over SSE; CLI/TUI can subscribe in-process.
 */

export type DeviceEventPayload =
  | ResourceEvent
  | StreamGapPayload
  | ProofExecutionChangedPayload
  | WorkflowChangedPayload
  | { type: "server.ready"; at: number; host: string; port: number }
  | { type: "device.list"; at: number; count: number }
  | { type: "device.booted"; at: number; serial: string }
  | { type: "device.authorization-requested"; at: number; serial: string }
  | { type: "job.queued"; at: number; jobId: string; action: string; serial?: string }
  | { type: "job.started"; at: number; jobId: string; action: string; serial?: string }
  | {
      type: "job.log";
      at: number;
      jobId: string;
      line: string;
      level?: "info" | "success" | "error" | "default";
    }
  | {
      type: "job.finished";
      at: number;
      jobId: string;
      action: string;
      ok: boolean;
      result?: unknown;
      error?: string;
      durationMs: number;
      healed?: boolean;
      cancelled?: boolean;
    }
  | { type: "job.healed"; at: number; jobId: string; action: string; healMessage: string }
  | { type: "job.paused"; at: number; jobId: string; action: string }
  | { type: "job.resumed"; at: number; jobId: string; action: string }
  | { type: "job.cancelled"; at: number; jobId: string; action: string }
  | { type: "job.step"; at: number; jobId: string; step: unknown }
  | { type: "job.frame"; at: number; jobId: string; frame: unknown }
  | { type: "snapshot.captured"; at: number; serial?: string; nodeCount: number }
  | { type: "screenshot.captured"; at: number; serial?: string; bytes: number }
  | {
      type: "authoring.committed";
      at: number;
      projectId: string;
      sessionId: string;
      appMapId: string;
      connectionId: string;
      revision: number;
    }
  | { type: "error"; at: number; message: string; where?: string; jobId?: string };

export type DeviceEvent = EventEnvelope<DeviceEventPayload>;
export type EventListener = (event: DeviceEvent) => void;

const listeners = new Set<EventListener>();
const recent: DeviceEvent[] = [];
const MAX_RECENT = 200;
let sequence = 0;

type ControlWrite = { db: DatabaseSync; pending: DeviceEvent[] };
const controlWrites = new AsyncLocalStorage<ControlWrite>();

function isDurableControlEvent(payload: DeviceEventPayload): payload is ResourceEvent {
  if (payload.type !== "resource.created" && payload.type !== "resource.updated") {
    if (payload.type !== "resource.deleted" && payload.type !== "lease.changed") return false;
  }
  if (!("resource" in payload) || payload.resource === "presence") return false;
  return true;
}

function persistControlEvent(db: DatabaseSync, event: DeviceEvent): void {
  const payload = event.payload;
  const inserted = db
    .prepare(
      `INSERT INTO control_events(id, at, project_id, type, resource, resource_id, payload)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.eventId,
      event.occurredAt,
      event.projectId,
      payload.type,
      "resource" in payload && typeof payload.resource === "string" ? payload.resource : null,
      "resourceId" in payload && typeof payload.resourceId === "string" ? payload.resourceId : null,
      JSON.stringify(event),
    );
  if (Number(inserted.lastInsertRowid) % 32 === 0) {
    db.prepare(
      `DELETE FROM control_events
       WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - 5000 FROM control_events)`,
    ).run();
  }
}

function dispatch(event: DeviceEvent): void {
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* never let a bad subscriber kill the bus */
    }
  }
}

/**
 * OpenCode-style write: persist durable events in the transaction.
 * Callers must notify after releasing the writer gate so subscribers can write again.
 */
export function runControlWrite<T>(
  db: DatabaseSync,
  write: () => T,
): { result: T; pending: DeviceEvent[] } {
  const pending: DeviceEvent[] = [];
  const result = controlWrites.run({ db, pending }, () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = write();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    }
  });
  return { result, pending };
}

export function notifyControlWrite(pending: readonly DeviceEvent[]): void {
  for (const event of pending) dispatch(event);
}

function systemContext(): OperationContext {
  const requestId = crypto.randomUUID();
  return {
    schemaVersion: 1 as const,
    actorId: "system:relay-core",
    actorKind: "system" as const,
    organizationId: "local",
    projectId: "default",
    operationId: "system.internal",
    requestId,
    idempotencyKey: requestId,
    issuedAt: now(),
  };
}

export function envelopeEvent<T extends RelayEventPayload>(
  payload: T,
  scope?: { organizationId: string; projectId: string },
): EventEnvelope<T> {
  const context = currentOperationContext() ?? systemContext();
  sequence += 1;
  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    sequence,
    actorId: context.actorId,
    actorKind: context.actorKind,
    organizationId: scope?.organizationId ?? context.organizationId,
    projectId: scope?.projectId ?? context.projectId,
    operationId: context.operationId,
    requestId: context.requestId,
    occurredAt: now(),
    ...(context.causationId ? { causationId: context.causationId } : {}),
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    ...(context.authoringSessionId ? { authoringSessionId: context.authoringSessionId } : {}),
    ...(context.leaseId ? { leaseId: context.leaseId } : {}),
    payload,
  };
}

export function publish(
  payload: DeviceEventPayload,
  scope?: { organizationId: string; projectId: string },
): DeviceEvent {
  const event = envelopeEvent(payload, scope);
  const write = controlWrites.getStore();
  if (write) {
    if (isDurableControlEvent(payload)) persistControlEvent(write.db, event);
    write.pending.push(event);
    return event;
  }
  dispatch(event);
  return event;
}

export function subscribe(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recentEvents(limit = 50): DeviceEvent[] {
  return recent.slice(-limit);
}

export function eventsAfter(afterSequence: number): {
  events: DeviceEvent[];
  gap: boolean;
  oldestAvailable: number;
  latestAvailable: number;
} {
  const oldestAvailable = recent[0]?.sequence ?? sequence + 1;
  const latestAvailable = recent.at(-1)?.sequence ?? sequence;
  return {
    events: recent.filter((event) => event.sequence > afterSequence),
    gap:
      afterSequence > 0 && (afterSequence < oldestAvailable - 1 || afterSequence > latestAvailable),
    oldestAvailable,
    latestAvailable,
  };
}

export function now(): number {
  return Date.now();
}
