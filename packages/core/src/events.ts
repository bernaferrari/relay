import type {
  EventEnvelope,
  RelayEventPayload,
  ResourceEvent,
  StreamGapPayload,
} from "@relay/protocol";
import { currentOperationContext, type OperationContext } from "./operation-context.js";

/**
 * Process-local event bus (OpenCode-style pub/sub for hosts).
 * Server fans this out over SSE; CLI/TUI can subscribe in-process.
 */

export type DeviceEventPayload =
  | ResourceEvent
  | StreamGapPayload
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
      journeyId: string;
      transitionId: string;
      revision: number;
    }
  | { type: "error"; at: number; message: string; where?: string };

export type DeviceEvent = EventEnvelope<DeviceEventPayload>;
export type EventListener = (event: DeviceEvent) => void;

const listeners = new Set<EventListener>();
const recent: DeviceEvent[] = [];
const MAX_RECENT = 200;
let sequence = 0;

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

export function envelopeEvent<T extends RelayEventPayload>(payload: T): EventEnvelope<T> {
  const context = currentOperationContext() ?? systemContext();
  sequence += 1;
  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    sequence,
    actorId: context.actorId,
    actorKind: context.actorKind,
    organizationId: context.organizationId,
    projectId: context.projectId,
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

export function publish(payload: DeviceEventPayload): DeviceEvent {
  const event = envelopeEvent(payload);
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      /* never let a bad subscriber kill the bus */
    }
  }
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
    gap: afterSequence > 0 && afterSequence < oldestAvailable - 1,
    oldestAvailable,
    latestAvailable,
  };
}

export function now(): number {
  return Date.now();
}
