import type {
  AppMap,
  AppMapCombine,
  AppMapPatch,
  AppMapMutationContext,
  AppMapTest,
  CaseStack,
  Flow,
  MapGroup,
  AppMapVariable,
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
  entity:
    | Flow
    | Routine
    | Proposal
    | CaseStack
    | MapGroup
    | AppMapVariable
    | AppMapTest
    | AppMapCombine,
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

export function saveAppMapVariable(
  map: AppMap,
  set: AppMapVariable,
  context: AppMapMutationContext,
): AppMap {
  assertEntityScope(map, set);
  if (set.apply.kind === "toggle" && set.options.length === 0) {
    appMapFail("invalid-map", "Toggle variables still need on/off rows");
  }
  return mutateAppMap(
    map,
    context,
    {
      eventType: "variable.saved",
      subject: { kind: "variable", id: set.id },
      summary: `Saved ${set.name}`,
    },
    (draft) => {
      draft.variables = { ...draft.variables, [set.id]: structuredClone(set) };
    },
  );
}

export function saveAppMapTest(
  map: AppMap,
  work: AppMapTest,
  context: AppMapMutationContext,
): AppMap {
  assertEntityScope(map, work);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "test.saved",
      subject: { kind: "test", id: work.id },
      summary: `Saved ${work.name}`,
    },
    (draft) => {
      draft.tests = { ...draft.tests, [work.id]: structuredClone(work) };
    },
  );
}

export function removeAppMapTest(
  map: AppMap,
  testId: string,
  context: AppMapMutationContext,
): AppMap {
  const work = map.tests?.[testId];
  if (!work) appMapFail("missing-reference", `Test ${testId} does not exist`);
  const dependent = Object.values(map.combines ?? {}).find((combine) =>
    combine.testIds.includes(testId),
  );
  if (dependent) {
    appMapFail("missing-reference", `Test ${testId} is still used by Combine ${dependent.id}`);
  }
  return mutateAppMap(
    map,
    context,
    {
      eventType: "test.removed",
      subject: { kind: "test", id: testId },
      summary: `Removed ${work.name}`,
    },
    (draft) => {
      const next = { ...draft.tests };
      delete next[testId];
      draft.tests = next;
    },
  );
}

export function saveAppMapCombine(
  map: AppMap,
  combine: AppMapCombine,
  context: AppMapMutationContext,
): AppMap {
  assertEntityScope(map, combine);
  for (const id of combine.variableIds) {
    if (!map.variables?.[id]) appMapFail("missing-reference", `Variable ${id} does not exist`);
  }
  for (const id of combine.testIds) {
    if (!map.tests?.[id]) appMapFail("missing-reference", `Test ${id} does not exist`);
  }
  for (const [variableId, optionIds] of Object.entries(combine.selected ?? {})) {
    if (!combine.variableIds.includes(variableId)) {
      appMapFail(
        "missing-reference",
        `Combine ${combine.id} selects unused Variable ${variableId}`,
      );
    }
    const variable = map.variables?.[variableId];
    if (!variable) appMapFail("missing-reference", `Variable ${variableId} does not exist`);
    const available = new Set(variable.options.map((option) => option.id));
    const missing = optionIds.find((optionId) => !available.has(optionId));
    if (missing) {
      appMapFail(
        "missing-reference",
        `Combine ${combine.id} selects missing value ${missing} from Variable ${variableId}`,
      );
    }
  }
  return mutateAppMap(
    map,
    context,
    {
      eventType: "combine.saved",
      subject: { kind: "combine", id: combine.id },
      summary: `Saved ${combine.name}`,
    },
    (draft) => {
      draft.combines = { ...draft.combines, [combine.id]: structuredClone(combine) };
    },
  );
}

export function removeAppMapCombine(
  map: AppMap,
  combineId: string,
  context: AppMapMutationContext,
): AppMap {
  const combine = map.combines?.[combineId];
  if (!combine) appMapFail("missing-reference", `Combine ${combineId} does not exist`);
  return mutateAppMap(
    map,
    context,
    {
      eventType: "combine.removed",
      subject: { kind: "combine", id: combineId },
      summary: `Removed ${combine.name}`,
    },
    (draft) => {
      const next = { ...draft.combines };
      delete next[combineId];
      draft.combines = next;
    },
  );
}

export function removeAppMapVariable(
  map: AppMap,
  variableId: string,
  context: AppMapMutationContext,
): AppMap {
  const set = map.variables?.[variableId];
  if (!set) appMapFail("missing-reference", `Variable ${variableId} does not exist`);
  const dependent = Object.values(map.combines ?? {}).find((combine) =>
    combine.variableIds.includes(variableId),
  );
  if (dependent) {
    appMapFail(
      "missing-reference",
      `Variable ${variableId} is still used by Combine ${dependent.id}`,
    );
  }
  return mutateAppMap(
    map,
    context,
    {
      eventType: "variable.removed",
      subject: { kind: "variable", id: variableId },
      summary: `Removed ${set.name}`,
    },
    (draft) => {
      const next = { ...draft.variables };
      delete next[variableId];
      draft.variables = next;
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
  if (Object.values(map.tests ?? {}).some((work) => work.setupFlowId === flowId)) {
    appMapFail("in-use", `Flow ${flowId} is still referenced by a screen tour`);
  }
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
    Object.values(map.flows).some((flow) => flow.setup?.routineId === routineId) ||
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
