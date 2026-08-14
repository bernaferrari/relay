import { appMapFail } from "./errors.js";
import type { AppMapEntity, AppMapScope } from "./model.js";
import { finiteTimestamp, identifier } from "./validation-primitives.js";

export function assertScope(value: AppMapScope, scope: AppMapScope, label: string): void {
  if (
    value.organizationId !== scope.organizationId ||
    value.projectId !== scope.projectId ||
    value.appMapId !== scope.appMapId
  ) {
    appMapFail("scope-mismatch", `${label} does not belong to this App Map project scope`);
  }
}

export function assertEntity(value: AppMapEntity, scope: AppMapScope, label: string): void {
  identifier(value.id, `${label}.id`);
  identifier(value.organizationId, `${label}.organizationId`);
  identifier(value.projectId, `${label}.projectId`);
  identifier(value.appMapId, `${label}.appMapId`);
  assertScope(value, scope, label);
  finiteTimestamp(value.createdAt, `${label}.createdAt`);
  finiteTimestamp(value.updatedAt, `${label}.updatedAt`);
  if (value.updatedAt < value.createdAt) {
    appMapFail("invalid-map", `${label}.updatedAt cannot precede createdAt`);
  }
}
