import { appMapFail } from "./errors.js";
import { APP_MAP_SCHEMA_VERSION, type ActionSpec, type AppMap } from "./model.js";
import {
  assertActivity,
  assertCaseStack,
  assertConnection,
  assertFlow,
  assertProposal,
  assertRoutine,
  assertRun,
  assertScreen,
  assertTargetResult,
  assertVariant,
  finiteTimestamp,
  identifier,
  objectValue,
  requiredText,
  safeInteger,
} from "./validation-shapes.js";

type ActionOwner = {
  ownerKind: "connection" | "routine";
  ownerId: string;
  actions: ActionSpec[];
};

export function actionOwners(map: AppMap): ActionOwner[] {
  return [
    ...Object.values(map.connections).map((connection) => ({
      ownerKind: "connection" as const,
      ownerId: connection.id,
      actions: connection.actions,
    })),
    ...Object.values(map.routines).map((routine) => ({
      ownerKind: "routine" as const,
      ownerId: routine.id,
      actions: routine.actions,
    })),
  ];
}

function assertEntityRecord<T>(
  values: Record<string, T>,
  label: string,
  assertValue: (value: T, itemLabel: string) => void,
): void {
  objectValue(values, label);
  for (const [key, value] of Object.entries(values)) {
    identifier(key, `${label} key`);
    assertValue(value, `${label}.${key}`);
    if ((value as { id?: unknown }).id !== key) {
      appMapFail("invalid-map", `${label} key ${key} does not match entity id`);
    }
  }
}

function assertVariants(map: AppMap): void {
  const targetKeys = new Set<string>();
  for (const screen of Object.values(map.screens)) {
    for (const variantId of screen.variantIds) {
      const variant = map.screenVariants[variantId];
      if (!variant || variant.screenId !== screen.id) {
        appMapFail(
          "missing-reference",
          `Screen ${screen.id} references missing variant ${variantId}`,
        );
      }
      const key = `${screen.id}\u0000${variant.targetProfile.id}`;
      if (targetKeys.has(key)) {
        appMapFail(
          "duplicate-id",
          `Screen ${screen.id} has more than one variant for target profile ${variant.targetProfile.id}`,
        );
      }
      targetKeys.add(key);
    }
  }

  for (const variant of Object.values(map.screenVariants)) {
    const screen = map.screens[variant.screenId];
    if (!screen || !screen.variantIds.includes(variant.id)) {
      appMapFail(
        "missing-reference",
        `Variant ${variant.id} is not owned by screen ${variant.screenId}`,
      );
    }
    if (variant.baseline?.source.kind !== "run") continue;
    const result = map.targetResults[variant.baseline.source.targetResultId];
    if (!result) {
      appMapFail(
        "missing-reference",
        `Variant ${variant.id} baseline references missing target result`,
      );
    }
    if (result.targetProfile.id !== variant.targetProfile.id) {
      appMapFail(
        "missing-reference",
        `Variant ${variant.id} baseline uses a different target profile`,
      );
    }
    const evidenceId = variant.baseline.source.evidenceId;
    if (evidenceId && !result.evidenceIds.includes(evidenceId)) {
      appMapFail(
        "missing-reference",
        `Variant ${variant.id} baseline evidence is absent from its target result`,
      );
    }
  }
}

function assertConnectionsAndActions(map: AppMap): void {
  for (const connection of Object.values(map.connections)) {
    if (!map.screens[connection.fromScreenId]) {
      appMapFail(
        "missing-reference",
        `Connection ${connection.id} starts at missing screen ${connection.fromScreenId}`,
      );
    }
    if (connection.destination.kind === "screen" && !map.screens[connection.destination.screenId]) {
      appMapFail(
        "missing-reference",
        `Connection ${connection.id} ends at missing screen ${connection.destination.screenId}`,
      );
    }
    if (connection.caseStackId && !map.caseStacks[connection.caseStackId]) {
      appMapFail(
        "missing-reference",
        `Connection ${connection.id} references missing case stack ${connection.caseStackId}`,
      );
    }
  }

  for (const owner of actionOwners(map)) {
    for (const action of owner.actions) {
      if (action.kind === "assertion" && action.assertion.kind === "screen") {
        if (!map.screens[action.assertion.screenId]) {
          appMapFail(
            "missing-reference",
            `${owner.ownerKind} ${owner.ownerId} asserts missing screen ${action.assertion.screenId}`,
          );
        }
        continue;
      }
      if (action.kind !== "routine") continue;
      const routine = map.routines[action.routineId];
      if (!routine) {
        appMapFail(
          "missing-reference",
          `${owner.ownerKind} ${owner.ownerId} references missing routine ${action.routineId}`,
        );
      }
      const parameters = new Map(
        routine.parameters.map((parameter) => [parameter.name, parameter]),
      );
      for (const name of Object.keys(action.bindings ?? {})) {
        if (!parameters.has(name)) {
          appMapFail(
            "missing-reference",
            `${owner.ownerKind} ${owner.ownerId} binds unknown parameter ${name} on routine ${routine.id}`,
          );
        }
      }
      for (const parameter of routine.parameters) {
        if (
          parameter.required &&
          parameter.default === undefined &&
          action.bindings?.[parameter.name] === undefined
        ) {
          appMapFail(
            "missing-reference",
            `${owner.ownerKind} ${owner.ownerId} does not bind required parameter ${parameter.name} on routine ${routine.id}`,
          );
        }
      }
    }
  }
}

function assertRoutineGraph(map: AppMap): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (routineId: string): void => {
    if (visiting.has(routineId)) {
      appMapFail("invalid-map", `Routine reference cycle includes ${routineId}`);
    }
    if (visited.has(routineId)) return;
    visiting.add(routineId);
    for (const action of map.routines[routineId]!.actions) {
      if (action.kind === "routine") visit(action.routineId);
    }
    visiting.delete(routineId);
    visited.add(routineId);
  };
  Object.keys(map.routines).sort().forEach(visit);
}

function assertFlows(map: AppMap): void {
  const names = new Set<string>();
  for (const flow of Object.values(map.flows)) {
    if (!map.screens[flow.startScreenId]) {
      appMapFail(
        "missing-reference",
        `Flow ${flow.id} starts at missing screen ${flow.startScreenId}`,
      );
    }
    if (names.has(flow.name))
      appMapFail("duplicate-id", `More than one flow is named ${flow.name}`);
    names.add(flow.name);
    let current: { kind: "screen"; screenId: string } | { kind: "end" } = {
      kind: "screen",
      screenId: flow.startScreenId,
    };
    for (const connectionId of flow.connectionIds) {
      const connection = map.connections[connectionId];
      if (!connection) {
        appMapFail(
          "missing-reference",
          `Flow ${flow.id} references missing connection ${connectionId}`,
        );
      }
      if (current.kind === "end") {
        appMapFail("invalid-map", `Flow ${flow.id} continues after reaching the end`);
      }
      if (connection.fromScreenId !== current.screenId) {
        appMapFail(
          "invalid-map",
          `Flow ${flow.id} is discontinuous at connection ${connection.id}`,
        );
      }
      current = connection.destination;
    }
  }
}

function assertRunReferences(map: AppMap): void {
  for (const run of Object.values(map.runs)) {
    if (run.flowId && !map.flows[run.flowId]) {
      appMapFail("missing-reference", `Run ${run.id} references missing flow ${run.flowId}`);
    }
    if (run.appMapRevision > map.revision) {
      appMapFail("missing-reference", `Run ${run.id} references a future App Map revision`);
    }
    for (const resultId of run.targetResultIds) {
      const result = map.targetResults[resultId];
      if (!result || result.runId !== run.id) {
        appMapFail(
          "missing-reference",
          `Run ${run.id} references missing target result ${resultId}`,
        );
      }
    }
  }
  for (const result of Object.values(map.targetResults)) {
    const run = map.runs[result.runId];
    if (!run || !run.targetResultIds.includes(result.id)) {
      appMapFail(
        "missing-reference",
        `Target result ${result.id} is not owned by run ${result.runId}`,
      );
    }
    if (result.connectionId && !map.connections[result.connectionId]) {
      appMapFail(
        "missing-reference",
        `Target result ${result.id} references missing connection ${result.connectionId}`,
      );
    }
  }
}

/** Runtime validation plus a defensive clone suitable for pure reducers. */
export function validateAppMap(value: unknown): AppMap {
  const input = objectValue(value, "App Map") as unknown as AppMap;
  if (input.schemaVersion !== APP_MAP_SCHEMA_VERSION) {
    appMapFail("invalid-map", "App Map schemaVersion must be 1");
  }
  identifier(input.id, "App Map.id");
  identifier(input.organizationId, "App Map.organizationId");
  identifier(input.projectId, "App Map.projectId");
  requiredText(input.name, "App Map.name");
  safeInteger(input.revision, "App Map.revision");
  finiteTimestamp(input.createdAt, "App Map.createdAt");
  finiteTimestamp(input.updatedAt, "App Map.updatedAt");
  if (input.updatedAt < input.createdAt) {
    appMapFail("invalid-map", "App Map.updatedAt cannot precede createdAt");
  }
  const scope = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    appMapId: input.id,
  };

  assertEntityRecord(input.screens, "App Map.screens", (item, label) =>
    assertScreen(item, scope, label),
  );
  assertEntityRecord(input.screenVariants, "App Map.screenVariants", (item, label) =>
    assertVariant(item, scope, label),
  );
  assertEntityRecord(input.connections, "App Map.connections", (item, label) =>
    assertConnection(item, scope, label),
  );
  assertEntityRecord(input.caseStacks, "App Map.caseStacks", (item, label) =>
    assertCaseStack(item, scope, label),
  );
  assertEntityRecord(input.routines, "App Map.routines", (item, label) =>
    assertRoutine(item, scope, label),
  );
  assertEntityRecord(input.flows, "App Map.flows", (item, label) => assertFlow(item, scope, label));
  assertEntityRecord(input.runs, "App Map.runs", (item, label) => assertRun(item, scope, label));
  assertEntityRecord(input.targetResults, "App Map.targetResults", (item, label) =>
    assertTargetResult(item, scope, label),
  );
  assertEntityRecord(input.proposals, "App Map.proposals", (item, label) =>
    assertProposal(item, scope, label),
  );
  assertEntityRecord(input.activity, "App Map.activity", (item, label) =>
    assertActivity(item, scope, label, input.revision),
  );

  const collections = {
    screens: input.screens,
    screenVariants: input.screenVariants,
    connections: input.connections,
    caseStacks: input.caseStacks,
    routines: input.routines,
    flows: input.flows,
    runs: input.runs,
    targetResults: input.targetResults,
    proposals: input.proposals,
  };
  for (const [name, values] of Object.entries(collections)) {
    const future = Object.values(values).find((item) => item.updatedAt > input.updatedAt);
    if (future) {
      appMapFail("invalid-map", `App Map.${name}.${future.id}.updatedAt exceeds App Map.updatedAt`);
    }
  }
  const futureProposal = Object.values(input.proposals).find(
    (proposal) => proposal.baseRevision > input.revision,
  );
  if (futureProposal) {
    appMapFail("invalid-map", `Proposal ${futureProposal.id} references a future App Map revision`);
  }

  assertVariants(input);
  assertConnectionsAndActions(input);
  assertRoutineGraph(input);
  assertFlows(input);
  assertRunReferences(input);
  return structuredClone(input);
}
