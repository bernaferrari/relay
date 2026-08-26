import type { EventEnvelope, ResourceKind } from "@relay/protocol";

export type EventRefresh =
  | "devices"
  | "appMaps"
  | "jobs"
  | "runs"
  | "variables"
  | "matrices"
  | "discoveries"
  | "authoring";

export type EventActivity = {
  actorId: string;
  actorKind: EventEnvelope["actorKind"];
  operationId: string;
  eventType: string;
  at: number;
};

export type EventProjection = {
  cursor: number;
  accepted: boolean;
  refresh: EventRefresh[];
  activity?: EventActivity;
};

const RESOURCE_REFRESH: Partial<Record<ResourceKind, EventRefresh>> = {
  variables: "variables",
  "app-map": "appMaps",
  matrix: "matrices",
  "discovery-session": "discoveries",
  "recording-session": "authoring",
};

const GAP_REFRESH: EventRefresh[] = [
  "devices",
  "appMaps",
  "jobs",
  "runs",
  "variables",
  "matrices",
  "discoveries",
  "authoring",
];

export function projectRelayEvent(cursor: number, event: EventEnvelope): EventProjection {
  if (event.sequence <= cursor) return { cursor, accepted: false, refresh: [] };
  const activity: EventActivity = {
    actorId: event.actorId,
    actorKind: event.actorKind,
    operationId: event.operationId,
    eventType: event.payload.type,
    at: event.occurredAt,
  };
  if (event.payload.type === "stream.gap") {
    return { cursor: event.sequence, accepted: true, refresh: GAP_REFRESH, activity };
  }
  if (event.payload.type === "authoring.committed") {
    return {
      cursor: event.sequence,
      accepted: true,
      refresh: ["authoring", "appMaps"],
      activity,
    };
  }
  if (
    event.payload.type === "resource.created" ||
    event.payload.type === "resource.updated" ||
    event.payload.type === "resource.deleted" ||
    event.payload.type === "lease.changed"
  ) {
    const resource = event.payload.resource;
    const refresh =
      typeof resource === "string" ? RESOURCE_REFRESH[resource as ResourceKind] : undefined;
    return {
      cursor: event.sequence,
      accepted: true,
      refresh: refresh ? [refresh] : [],
      activity,
    };
  }
  const refresh: EventRefresh[] = [];
  if (event.payload.type.startsWith("job.")) refresh.push("jobs");
  if (
    event.payload.type === "job.finished" ||
    event.payload.type === "job.cancelled" ||
    event.payload.type === "job.healed"
  ) {
    refresh.push("runs");
  }
  return { cursor: event.sequence, accepted: true, refresh, activity };
}
