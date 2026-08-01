import { appMapFail } from "./errors.js";
import type { ActivityEvent, AppMap, AppMapMutationContext } from "./model.js";
import { validateAppMap } from "./validation.js";
import { finiteTimestamp, identifier, safeInteger } from "./validation-shapes.js";

type MutationEvent = Pick<ActivityEvent, "eventType" | "subject" | "summary">;

function assertContext(map: AppMap, context: AppMapMutationContext): void {
  safeInteger(context.expectedRevision, "mutation.expectedRevision");
  if (context.expectedRevision !== map.revision) {
    appMapFail(
      "revision-conflict",
      `Expected App Map revision ${context.expectedRevision}, current revision is ${map.revision}`,
    );
  }
  if (map.revision === Number.MAX_SAFE_INTEGER) {
    appMapFail("revision-conflict", "App Map revision is exhausted");
  }
  identifier(context.eventId, "mutation.eventId");
  identifier(context.actorId, "mutation.actorId");
  if (
    !(
      context.actorKind === "human" ||
      context.actorKind === "agent" ||
      context.actorKind === "system"
    )
  ) {
    appMapFail("invalid-map", "mutation.actorKind is unsupported");
  }
  finiteTimestamp(context.at, "mutation.at");
  if (context.at < map.updatedAt) {
    appMapFail("invalid-map", "mutation.at cannot precede App Map.updatedAt");
  }
  if (map.activity[context.eventId]) {
    appMapFail("duplicate-id", `Activity event ${context.eventId} already exists`);
  }
}

export function mutateAppMap(
  value: AppMap,
  context: AppMapMutationContext,
  event: MutationEvent,
  apply: (draft: AppMap) => void,
): AppMap {
  const draft = validateAppMap(value);
  assertContext(draft, context);
  apply(draft);
  const beforeRevision = draft.revision;
  draft.revision += 1;
  draft.updatedAt = context.at;
  draft.activity[context.eventId] = {
    id: context.eventId,
    organizationId: draft.organizationId,
    projectId: draft.projectId,
    appMapId: draft.id,
    actorId: context.actorId,
    actorKind: context.actorKind,
    eventType: event.eventType,
    subject: event.subject,
    summary: event.summary,
    at: context.at,
    beforeRevision,
    afterRevision: draft.revision,
  };
  return validateAppMap(draft);
}
