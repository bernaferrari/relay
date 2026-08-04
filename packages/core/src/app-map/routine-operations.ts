import { appMapFail } from "./errors.js";
import type { AppMap, RoutineImpactPreview, RoutineUsageReference } from "./model.js";
import { actionOwners, validateAppMap } from "./validation.js";
import { identifier } from "./validation-shapes.js";

export function previewRoutineImpact(value: AppMap, routineId: string): RoutineImpactPreview {
  const map = validateAppMap(value);
  identifier(routineId, "routineId");
  if (!map.routines[routineId]) {
    appMapFail("missing-reference", `Routine ${routineId} does not exist`);
  }
  const directUsages: RoutineUsageReference[] = [
    ...actionOwners(map).flatMap((owner) =>
      owner.actions.flatMap((action) =>
        action.kind === "routine" && action.routineId === routineId
          ? [{ ownerKind: owner.ownerKind, ownerId: owner.ownerId, actionId: action.id }]
          : [],
      ),
    ),
    ...Object.values(map.flows).flatMap((flow) =>
      flow.setup?.routineId === routineId ? [{ ownerKind: "flow" as const, ownerId: flow.id }] : [],
    ),
  ];
  directUsages.sort(
    (left, right) =>
      left.ownerKind.localeCompare(right.ownerKind) ||
      left.ownerId.localeCompare(right.ownerId) ||
      (left.actionId ?? "").localeCompare(right.actionId ?? ""),
  );

  const affectedRoutines = new Set([routineId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const routine of Object.values(map.routines)) {
      if (affectedRoutines.has(routine.id)) continue;
      if (
        routine.actions.some(
          (action) => action.kind === "routine" && affectedRoutines.has(action.routineId),
        )
      ) {
        affectedRoutines.add(routine.id);
        changed = true;
      }
    }
  }

  const affectedConnectionIds = Object.values(map.connections)
    .filter((connection) =>
      connection.actions.some(
        (action) => action.kind === "routine" && affectedRoutines.has(action.routineId),
      ),
    )
    .map((connection) => connection.id)
    .sort();
  const connectionSet = new Set(affectedConnectionIds);
  const affectedFlowIds = Object.values(map.flows)
    .filter(
      (flow) =>
        (flow.setup !== undefined && affectedRoutines.has(flow.setup.routineId)) ||
        flow.connectionIds.some((connectionId) => connectionSet.has(connectionId)),
    )
    .map((flow) => flow.id)
    .sort();
  return {
    routineId,
    directUsages,
    affectedRoutineIds: [...affectedRoutines].filter((id) => id !== routineId).sort(),
    affectedConnectionIds,
    affectedFlowIds,
  };
}
