import type { AppMap, AppMapMutationContext, MapGroup } from "./model.js";
import { assertEntityScope } from "./entity-operations.js";
import { appMapFail } from "./errors.js";
import { assertMapGroup, identifier } from "./validation-shapes.js";
import { mutateAppMap } from "./mutation.js";

function scopeFor(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
}

export function putMapGroup(draft: AppMap, group: MapGroup): void {
  assertEntityScope(draft, group);
  assertMapGroup(group, scopeFor(draft), "Map Group");
  for (const screenId of group.screenIds) {
    if (!draft.screens[screenId]) {
      appMapFail("missing-reference", `Group ${group.id} references missing screen ${screenId}`);
    }
    const owner = Object.values(draft.groups).find(
      (candidate) => candidate.id !== group.id && candidate.screenIds.includes(screenId),
    );
    if (owner) {
      appMapFail("in-use", `Screen ${screenId} already belongs to Group ${owner.id}`);
    }
  }
  draft.groups[group.id] = structuredClone(group);
}

export function dropMapGroup(draft: AppMap, groupId: string): void {
  identifier(groupId, "groupId");
  if (!draft.groups[groupId]) appMapFail("missing-reference", `Group ${groupId} does not exist`);
  delete draft.groups[groupId];
}

export function saveAppMapGroup(
  map: AppMap,
  group: MapGroup,
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "group.saved",
      subject: { kind: "group", id: group.id },
      summary: `Saved Group ${group.name}`,
    },
    (draft) => putMapGroup(draft, group),
  );
}

export function removeAppMapGroup(
  map: AppMap,
  groupId: string,
  context: AppMapMutationContext,
): AppMap {
  const group = map.groups[groupId];
  if (!group) appMapFail("missing-reference", `Group ${groupId} does not exist`);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "group.removed",
      subject: { kind: "group", id: groupId },
      summary: `Removed Group ${group.name}`,
    },
    (draft) => dropMapGroup(draft, groupId),
  );
}
