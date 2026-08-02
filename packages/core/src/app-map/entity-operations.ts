import type {
  AppMap,
  AppMapPatch,
  AppMapMutationContext,
  Flow,
  Proposal,
  Routine,
} from "./model.js";
import { appMapFail } from "./errors.js";
import { mutateAppMap } from "./mutation.js";

export function updateAppMap(
  map: AppMap,
  patch: AppMapPatch,
  context: AppMapMutationContext,
): AppMap {
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) appMapFail("invalid-map", "App Map name is required");
  return mutateAppMap(
    map,
    context,
    {
      eventType: "app-map.updated",
      subject: { kind: "app-map", id: map.id },
      summary: `Updated ${name ?? map.name}`,
    },
    (draft) => {
      if (name) draft.name = name;
    },
  );
}

function assertEntityScope(map: AppMap, entity: Flow | Routine | Proposal): void {
  if (
    entity.organizationId !== map.organizationId ||
    entity.projectId !== map.projectId ||
    entity.appMapId !== map.id
  ) {
    appMapFail("scope-mismatch", `${entity.id} does not belong to App Map ${map.id}`);
  }
}

export function saveAppMapFlow(map: AppMap, flow: Flow, context: AppMapMutationContext): AppMap {
  assertEntityScope(map, flow);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "flow.saved",
      subject: { kind: "flow", id: flow.id },
      summary: `Saved ${flow.name}`,
    },
    (draft) => {
      draft.flows[flow.id] = structuredClone(flow);
    },
  );
}

export function removeAppMapFlow(
  map: AppMap,
  flowId: string,
  context: AppMapMutationContext,
): AppMap {
  const flow = map.flows[flowId];
  if (!flow) appMapFail("missing-reference", `Flow ${flowId} does not exist`);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "flow.removed",
      subject: { kind: "flow", id: flowId },
      summary: `Removed ${flow.name}`,
    },
    (draft) => {
      delete draft.flows[flowId];
    },
  );
}

export function saveAppMapRoutine(
  map: AppMap,
  routine: Routine,
  context: AppMapMutationContext,
): AppMap {
  assertEntityScope(map, routine);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "routine.saved",
      subject: { kind: "routine", id: routine.id },
      summary: `Saved ${routine.name}`,
    },
    (draft) => {
      draft.routines[routine.id] = structuredClone(routine);
    },
  );
}

export function removeAppMapRoutine(
  map: AppMap,
  routineId: string,
  context: AppMapMutationContext,
): AppMap {
  const routine = map.routines[routineId];
  if (!routine) appMapFail("missing-reference", `Routine ${routineId} does not exist`);
  const used =
    Object.values(map.connections).some((connection) =>
      connection.actions.some(
        (action) => action.kind === "routine" && action.routineId === routineId,
      ),
    ) ||
    Object.values(map.routines).some(
      (candidate) =>
        candidate.id !== routineId &&
        candidate.actions.some(
          (action) => action.kind === "routine" && action.routineId === routineId,
        ),
    );
  if (used) appMapFail("in-use", `Routine ${routineId} is still referenced`);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "routine.removed",
      subject: { kind: "routine", id: routineId },
      summary: `Removed ${routine.name}`,
    },
    (draft) => {
      delete draft.routines[routineId];
    },
  );
}

export function submitAppMapProposal(
  map: AppMap,
  proposal: Proposal,
  context: AppMapMutationContext,
): AppMap {
  assertEntityScope(map, proposal);
  if (proposal.status !== "pending") appMapFail("proposal-state", "New proposals must be pending");
  if (proposal.baseRevision !== map.revision) {
    appMapFail(
      "revision-conflict",
      `Proposal base revision ${proposal.baseRevision} does not match ${map.revision}`,
    );
  }
  if (map.proposals[proposal.id])
    appMapFail("duplicate-id", `Proposal ${proposal.id} already exists`);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "proposal.submitted",
      subject: { kind: "proposal", id: proposal.id },
      summary: `Proposed ${proposal.title}`,
    },
    (draft) => {
      draft.proposals[proposal.id] = structuredClone(proposal);
    },
  );
}
