import { appMapFail } from "./errors.js";
import { assertScope } from "./entity-validation.js";
import type { ActivityEvent, AppMapScope } from "./model.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  requiredText,
  safeInteger,
  stringArray,
} from "./validation-primitives.js";

export function assertActivity(
  event: ActivityEvent,
  scope: AppMapScope,
  label: string,
  mapRevision: number,
): void {
  identifier(event.id, `${label}.id`);
  identifier(event.organizationId, `${label}.organizationId`);
  identifier(event.projectId, `${label}.projectId`);
  identifier(event.appMapId, `${label}.appMapId`);
  assertScope(event, scope, label);
  identifier(event.actorId, `${label}.actorId`);
  if (!(event.actorKind === "human" || event.actorKind === "agent" || event.actorKind === "system"))
    appMapFail("invalid-map", `${label}.actorKind is unsupported`);
  const eventTypes: ActivityEvent["eventType"][] = [
    "app-map.updated",
    "app-map.committed",
    "screen.added",
    "screen.updated",
    "screen.removed",
    "screen.consolidated",
    "connection.connected",
    "connection.updated",
    "connection.removed",
    "group.saved",
    "group.removed",
    "flow.saved",
    "flow.removed",
    "routine.saved",
    "routine.removed",
    "case-stack.saved",
    "case-stack.attached",
    "case-stack.removed",
    "variable.saved",
    "variable.removed",
    "test.saved",
    "test.undone",
    "test.redone",
    "test.removed",
    "combine.saved",
    "combine.removed",
    "recording.committed",
    "run.finished",
    "proposal.submitted",
    "proposal.approved",
    "proposal.rejected",
    "proposal.reverted",
  ];
  if (!eventTypes.includes(event.eventType))
    appMapFail("invalid-map", `${label}.eventType is unsupported`);
  objectValue(event.subject, `${label}.subject`);
  if (
    !(
      event.subject.kind === "app-map" ||
      event.subject.kind === "screen" ||
      event.subject.kind === "connection" ||
      event.subject.kind === "group" ||
      event.subject.kind === "flow" ||
      event.subject.kind === "routine" ||
      event.subject.kind === "case-stack" ||
      event.subject.kind === "variable" ||
      event.subject.kind === "test" ||
      event.subject.kind === "combine" ||
      event.subject.kind === "proposal" ||
      event.subject.kind === "run"
    )
  )
    appMapFail("invalid-map", `${label}.subject.kind is unsupported`);
  identifier(event.subject.id, `${label}.subject.id`);
  if (event.touched !== undefined) {
    stringArray(event.touched, `${label}.touched`);
    if (!event.touched.length) appMapFail("invalid-map", `${label}.touched must not be empty`);
    if (new Set(event.touched).size !== event.touched.length) {
      appMapFail("duplicate-id", `${label}.touched contains duplicate subjects`);
    }
  }
  requiredText(event.summary, `${label}.summary`, 240);
  finiteTimestamp(event.at, `${label}.at`);
  safeInteger(event.beforeRevision, `${label}.beforeRevision`);
  safeInteger(event.afterRevision, `${label}.afterRevision`);
  if (event.afterRevision !== event.beforeRevision + 1 || event.afterRevision > mapRevision)
    appMapFail("invalid-map", `${label} has an invalid revision transition`);
}
