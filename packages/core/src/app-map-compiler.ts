import type {
  ActionSpec,
  AppMap,
  AppMapCompiledFlow,
  AppMapCompiledRecipe,
  AppMapCompiledStepProvenance,
  AssertionSpec,
  RecipeStep,
  Routine,
  Screen,
} from "@relay/protocol";
import { validateAppMap } from "./app-map.js";

export type AppMapCompileErrorCode =
  | "missing-flow"
  | "draft-connection"
  | "missing-screen-identity";

export class AppMapCompileError extends Error {
  readonly code: AppMapCompileErrorCode;

  constructor(code: AppMapCompileErrorCode, message: string) {
    super(message);
    this.name = "AppMapCompileError";
    this.code = code;
  }
}

function fail(code: AppMapCompileErrorCode, message: string): never {
  throw new AppMapCompileError(code, message);
}

function recipeId(map: AppMap, kind: "flow" | "routine", id: string): string {
  return `app-map:${map.id}:${kind}:${id}:r${map.revision}`;
}

function stableStep(step: RecipeStep, actionId: string, index: number): RecipeStep {
  return {
    ...structuredClone(step),
    id: step.id?.trim() || `relay-action-${actionId}-${index + 1}`,
  };
}

function screenExpectation(screen: Screen, stepId: string): RecipeStep {
  if (!screen.identity) {
    fail(
      "missing-screen-identity",
      `Screen "${screen.title}" cannot be verified until it has an approved identity`,
    );
  }
  return {
    id: stepId,
    kind: "expect-screen",
    screenId: screen.id,
    screenTitle: screen.title,
    fingerprint: screen.identity.fingerprint,
    ...(screen.identity.aliases?.length ? { aliases: [...screen.identity.aliases] } : {}),
  };
}

function assertionStep(map: AppMap, actionId: string, assertion: AssertionSpec): RecipeStep {
  if (assertion.kind === "screen") {
    return screenExpectation(map.screens[assertion.screenId]!, `relay-action-${actionId}`);
  }
  if (assertion.kind === "target") {
    return {
      id: `relay-action-${actionId}`,
      kind: "expect",
      target: structuredClone(assertion.target),
      condition: assertion.condition,
      ...(assertion.timeoutMs === undefined ? {} : { timeoutMs: assertion.timeoutMs }),
    };
  }
  return {
    id: `relay-action-${actionId}`,
    kind: "assert-content",
    input: assertion.input,
    expected: assertion.expected,
    match: assertion.match,
  };
}

function actionSteps(map: AppMap, action: ActionSpec): RecipeStep[] {
  switch (action.kind) {
    case "recorded":
      return action.steps.map((step, index) => stableStep(step, action.id, index));
    case "tap":
      return [
        { id: `relay-action-${action.id}`, kind: "tap", target: structuredClone(action.target) },
      ];
    case "text":
      return [
        {
          id: `relay-action-${action.id}`,
          kind: "type",
          text: action.text,
          ...(action.target ? { target: structuredClone(action.target) } : {}),
        },
      ];
    case "gesture":
      return action.gesture.kind === "swipe"
        ? [
            {
              id: `relay-action-${action.id}`,
              kind: "swipe",
              from: structuredClone(action.gesture.from),
              to: structuredClone(action.gesture.to),
              ...(action.gesture.durationMs === undefined
                ? {}
                : { durationMs: action.gesture.durationMs }),
            },
          ]
        : [
            {
              id: `relay-action-${action.id}`,
              kind: "scroll",
              direction: action.gesture.direction,
              ...(action.gesture.amount === undefined ? {} : { amount: action.gesture.amount }),
            },
          ];
    case "back":
    case "home":
      return [{ id: `relay-action-${action.id}`, kind: "key", key: action.kind }];
    case "wait":
      return action.ms === 0
        ? []
        : [{ id: `relay-action-${action.id}`, kind: "sleep", ms: action.ms }];
    case "assertion":
      return [assertionStep(map, action.id, action.assertion)];
    case "routine":
      return [
        {
          id: `relay-action-${action.id}`,
          kind: "module",
          recipeId: recipeId(map, "routine", action.routineId),
          ...(action.bindings ? { bindings: structuredClone(action.bindings) } : {}),
        },
      ];
    case "passive":
      return [];
  }
}

function compileRecipe(input: {
  map: AppMap;
  id: string;
  title: string;
  description?: string;
  parameters?: Routine["parameters"];
  ownerKind: "connection" | "routine";
  ownerId: string;
  actions: ActionSpec[];
  ensureRoutine?: (routineId: string) => void;
}): AppMapCompiledRecipe {
  const steps: RecipeStep[] = [];
  const stepProvenance: AppMapCompiledStepProvenance[] = [];
  for (const action of input.actions) {
    if (action.kind === "routine") input.ensureRoutine?.(action.routineId);
    for (const step of actionSteps(input.map, action)) {
      const stepIndex = steps.length;
      steps.push(step);
      stepProvenance.push({
        recipeId: input.id,
        stepIndex,
        stepId: step.id!,
        origin: "action",
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        actionId: action.id,
      });
    }
  }
  return {
    id: input.id,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    parameters: structuredClone(input.parameters ?? []),
    steps,
    stepProvenance,
  };
}

/** Compile one saved flow into the exact recipes consumed by the runner. */
export function compileAppMapFlow(mapInput: AppMap, flowId: string): AppMapCompiledFlow {
  const map = validateAppMap(mapInput);
  const flow = map.flows[flowId];
  if (!flow) fail("missing-flow", `Flow "${flowId}" does not exist`);

  const recipes: Record<string, AppMapCompiledRecipe> = {};
  const ensureRoutine = (routineId: string): void => {
    const routine = map.routines[routineId]!;
    const id = recipeId(map, "routine", routine.id);
    if (recipes[id]) return;
    // Validation rejects cycles before compilation, so this placeholder only
    // prevents duplicate work when several owners reuse the same routine.
    recipes[id] = {
      id,
      title: routine.name,
      parameters: [],
      steps: [],
      stepProvenance: [],
    };
    recipes[id] = compileRecipe({
      map,
      id,
      title: routine.name,
      ...(routine.description ? { description: routine.description } : {}),
      parameters: routine.parameters,
      ownerKind: "routine",
      ownerId: routine.id,
      actions: routine.actions,
      ensureRoutine,
    });
  };

  const rootRecipeId = recipeId(map, "flow", flow.id);
  const root: AppMapCompiledRecipe = {
    id: rootRecipeId,
    title: `${map.name} · ${flow.name}`,
    parameters: [],
    steps: [],
    stepProvenance: [],
  };
  const connections: AppMapCompiledFlow["connections"] = [];
  const caseStackIds = new Set<string>();
  let terminal: AppMapCompiledFlow["terminal"] = {
    kind: "screen",
    screenId: flow.startScreenId,
  };

  for (let connectionIndex = 0; connectionIndex < flow.connectionIds.length; connectionIndex += 1) {
    const connection = map.connections[flow.connectionIds[connectionIndex]!]!;
    if (connection.state !== "ready") {
      fail(
        "draft-connection",
        `Connection "${connection.label?.trim() || connection.id}" is still a draft`,
      );
    }
    const rangeStart = root.steps.length;
    const compiled = compileRecipe({
      map,
      id: rootRecipeId,
      title: root.title,
      ownerKind: "connection",
      ownerId: connection.id,
      actions: connection.actions,
      ensureRoutine,
    });
    for (let index = 0; index < compiled.steps.length; index += 1) {
      const step = compiled.steps[index]!;
      const provenance = compiled.stepProvenance[index]!;
      const stepIndex = root.steps.length;
      root.steps.push(step);
      root.stepProvenance.push({ ...provenance, stepIndex });
    }
    if (connection.destination.kind === "screen") {
      const destination = map.screens[connection.destination.screenId]!;
      const stepIndex = root.steps.length;
      const step = screenExpectation(destination, `relay-destination-${connection.id}`);
      root.steps.push(step);
      root.stepProvenance.push({
        recipeId: rootRecipeId,
        stepIndex,
        stepId: step.id!,
        origin: "destination",
        ownerKind: "connection",
        ownerId: connection.id,
      });
    }
    connections.push({
      connectionIndex,
      connectionId: connection.id,
      fromScreenId: connection.fromScreenId,
      destination: structuredClone(connection.destination),
      ...(connection.caseStackId ? { caseStackId: connection.caseStackId } : {}),
      compiledStepRange: [rangeStart, root.steps.length],
    });
    if (connection.caseStackId) caseStackIds.add(connection.caseStackId);
    terminal = structuredClone(connection.destination);
  }
  recipes[rootRecipeId] = root;

  return {
    schemaVersion: 1,
    appMapId: map.id,
    appMapRevision: map.revision,
    flow: { id: flow.id, name: flow.name, startScreenId: flow.startScreenId },
    rootRecipeId,
    recipes,
    connections,
    caseStacks: [...caseStackIds]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => structuredClone(map.caseStacks[id]!)),
    terminal,
  };
}
