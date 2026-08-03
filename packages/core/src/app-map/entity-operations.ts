import type {
  AppMap,
  AppMapPatch,
  AppMapMutationContext,
  CaseStack,
  Flow,
  MapGroup,
  Proposal,
  Routine,
} from "./model.js";
import { appMapFail } from "./errors.js";
import { mutateAppMap } from "./mutation.js";
import { proposalConflictsSince } from "./proposal-conflicts.js";

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
    (draft) => applyAppMapPatch(draft, patch),
  );
}

export function applyAppMapPatch(draft: AppMap, patch: AppMapPatch): void {
  const name = patch.name?.trim();
  const description = patch.description?.trim();
  if (patch.name !== undefined && !name) appMapFail("invalid-map", "App Map name is required");
  if (name) draft.name = name;
  if (patch.description !== undefined) {
    if (description) draft.description = description;
    else delete draft.description;
  }
  if (patch.notes !== undefined) draft.notes = structuredClone(patch.notes);
}

export function assertEntityScope(
  map: AppMap,
  entity: Flow | Routine | Proposal | CaseStack | MapGroup,
): void {
  if (
    entity.organizationId !== map.organizationId ||
    entity.projectId !== map.projectId ||
    entity.appMapId !== map.id
  ) {
    appMapFail("scope-mismatch", `${entity.id} does not belong to App Map ${map.id}`);
  }
}

export function attachAppMapCaseStack(
  map: AppMap,
  connectionId: string,
  caseStackId: string,
  stack: CaseStack | undefined,
  context: AppMapMutationContext,
): AppMap {
  if (stack) {
    assertEntityScope(map, stack);
    if (stack.id !== caseStackId) {
      appMapFail("scope-mismatch", `Case stack ${stack.id} does not match ${caseStackId}`);
    }
  }
  const resolved = stack ?? map.caseStacks[caseStackId];
  if (!resolved) appMapFail("missing-reference", `Case stack ${caseStackId} does not exist`);
  if (!map.connections[connectionId]) {
    appMapFail("missing-reference", `Connection ${connectionId} does not exist`);
  }
  return mutateAppMap(
    map,
    context,
    {
      eventType: "case-stack.attached",
      subject: { kind: "connection", id: connectionId },
      summary: `Applied ${resolved.name}`,
    },
    (draft) => {
      if (stack) draft.caseStacks[caseStackId] = structuredClone(stack);
      draft.connections[connectionId]!.caseStackId = caseStackId;
      draft.connections[connectionId]!.updatedAt = context.at;
    },
  );
}

export function saveAppMapCaseStack(
  map: AppMap,
  stack: CaseStack,
  context: AppMapMutationContext,
): AppMap {
  assertEntityScope(map, stack);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "case-stack.saved",
      subject: { kind: "case-stack", id: stack.id },
      summary: `Saved ${stack.name}`,
    },
    (draft) => {
      draft.caseStacks[stack.id] = structuredClone(stack);
    },
  );
}

export function removeAppMapCaseStack(
  map: AppMap,
  caseStackId: string,
  context: AppMapMutationContext,
): AppMap {
  const stack = map.caseStacks[caseStackId];
  if (!stack) appMapFail("missing-reference", `Case stack ${caseStackId} does not exist`);
  const used = Object.values(map.connections).some(
    (connection) => connection.caseStackId === caseStackId,
  );
  if (used) appMapFail("in-use", `Case stack ${caseStackId} is still referenced`);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "case-stack.removed",
      subject: { kind: "case-stack", id: caseStackId },
      summary: `Removed ${stack.name}`,
    },
    (draft) => {
      delete draft.caseStacks[caseStackId];
    },
  );
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
  if (proposal.baseRevision > map.revision) {
    appMapFail("revision-conflict", `Proposal references future revision ${proposal.baseRevision}`);
  }
  const originalBaseRevision = proposal.baseRevision;
  if (originalBaseRevision < map.revision) {
    const conflicts = proposalConflictsSince(map, proposal, originalBaseRevision);
    if (conflicts.conflict) {
      appMapFail(
        "revision-conflict",
        `Proposal conflicts with newer changes to ${conflicts.subjects.join(", ")}`,
      );
    }
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
      draft.proposals[proposal.id] = {
        ...structuredClone(proposal),
        baseRevision: draft.revision,
        ...(originalBaseRevision < draft.revision ? { sourceRevision: originalBaseRevision } : {}),
      };
    },
  );
}
