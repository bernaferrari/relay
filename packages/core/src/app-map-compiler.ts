import type {
  ActionSpec,
  AppMap,
  AppMapCompiledFlow,
  AppMapCompiledConnectionRun,
  AppMapCompiledRecipe,
  AppMapCompiledStepProvenance,
  AssertionSpec,
  Connection,
  RecipeStep,
  Routine,
  Screen,
  SemanticRevealPlan,
  StepTarget,
} from "@relay/protocol";
import { createHash } from "node:crypto";
import { validateAppMap } from "./app-map.js";
import { observeScreenIdentityForHost } from "./screen-identity.js";
import type { SnapshotNode } from "./device.js";
import { semanticTargetMatches } from "./scroll-surface-semantic-index.js";
import { compiledJudgeFields } from "./judge-assertion-fields.js";

export type AppMapCompileErrorCode =
  | "missing-flow"
  | "missing-connection"
  | "missing-routine"
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

function recipeId(map: AppMap, kind: "flow" | "connection" | "routine", id: string): string {
  return `app-map:${map.id}:${kind}:${id}:r${map.revision}`;
}

/** Generated step identities share the public Recipe validation membrane.
 * Preserve readable IDs when they fit and collapse long App Map entity IDs
 * to a stable digest instead of emitting a plan that cannot be executed. */
export function compiledAppMapStepId(prefix: string, sourceId: string): string {
  const candidate = `${prefix}-${sourceId}`;
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(candidate)) return candidate;
  const digest = createHash("sha256").update(sourceId, "utf8").digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

function routineCompiler(map: AppMap, recipes: Record<string, AppMapCompiledRecipe>) {
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
  return ensureRoutine;
}

function stableStep(step: RecipeStep, actionId: string, index: number): RecipeStep {
  return {
    ...structuredClone(step),
    id: step.id?.trim() || compiledAppMapStepId("relay-action", `${actionId}-${index + 1}`),
  };
}

export function screenExpectation(
  map: AppMap,
  screen: Screen,
  stepId: string,
  evidenceSurface = screen.evidenceSurface,
): RecipeStep {
  if (!screen.identity) {
    fail(
      "missing-screen-identity",
      `Screen "${screen.title}" cannot be verified until it has an approved identity`,
    );
  }
  const archivedVariants = screen.consolidations?.flatMap(
    (consolidation) => consolidation.sourceVariants,
  );
  const observationsByFingerprint = new Map(
    [
      ...screen.variantIds.map((variantId) => map.screenVariants[variantId]),
      ...(archivedVariants ?? []),
    ]
      .flatMap((variant) =>
        variant?.observation?.nodes.length ? [structuredClone(variant.observation)] : [],
      )
      .map((observation) => [observation.fingerprint, observation]),
  );
  const aliases = new Set(screen.identity.aliases ?? []);
  for (const consolidation of screen.consolidations ?? []) {
    for (const source of consolidation.sourceScreens) {
      if (!source.identity) continue;
      aliases.add(source.identity.fingerprint);
      for (const alias of source.identity.aliases ?? []) aliases.add(alias);
    }
  }
  for (const variant of [
    ...screen.variantIds.map((variantId) => map.screenVariants[variantId]),
    ...(archivedVariants ?? []),
  ]) {
    const nodes = variant?.observation?.nodes;
    if (!nodes?.length) continue;
    const hosted = observeScreenIdentityForHost(nodes as SnapshotNode[], {
      appMapId: map.id,
      browserTargetId: variant.targetProfile?.targetId,
    });
    if (hosted.fingerprint) aliases.add(hosted.fingerprint);
  }
  aliases.delete(screen.identity.fingerprint);
  const observations = [...observationsByFingerprint.values()];
  return {
    id: stepId,
    kind: "expect-screen",
    screenId: screen.id,
    screenTitle: screen.title,
    fingerprint: screen.identity.fingerprint,
    timeoutMs: 5000,
    ...(evidenceSurface ? { evidenceSurface } : {}),
    ...(screen.handoff?.ownerApp ? { expectedApp: screen.handoff.ownerApp } : {}),
    ...(aliases.size ? { aliases: [...aliases] } : {}),
    ...(observations.length ? { observations } : {}),
    ...(screen.identity.ignoreRegions?.length
      ? {
          ignoreRegions: screen.identity.ignoreRegions.map((region) => ({ ...region })),
        }
      : {}),
  };
}

function assertionStep(map: AppMap, actionId: string, assertion: AssertionSpec): RecipeStep {
  if (assertion.kind === "screen") {
    return screenExpectation(
      map,
      map.screens[assertion.screenId]!,
      compiledAppMapStepId("relay-action", actionId),
    );
  }
  if (assertion.kind === "target") {
    return {
      id: compiledAppMapStepId("relay-action", actionId),
      kind: "expect",
      target: structuredClone(assertion.target),
      condition: assertion.condition,
      ...(assertion.timeoutMs === undefined ? {} : { timeoutMs: assertion.timeoutMs }),
    };
  }
  if (assertion.kind === "layout") {
    return {
      id: compiledAppMapStepId("relay-action", actionId),
      kind: "assert-layout",
      relation: assertion.relation,
      first: structuredClone(assertion.first),
      second: structuredClone(assertion.second),
      ...(assertion.timeoutMs === undefined ? {} : { timeoutMs: assertion.timeoutMs }),
    };
  }
  if (assertion.kind === "visual") {
    return {
      id: compiledAppMapStepId("relay-action", actionId),
      kind: "evaluate-visual",
      criteria: [...assertion.criteria],
      ...(assertion.region ? { region: { ...assertion.region } } : {}),
      ...compiledJudgeFields(assertion),
    };
  }
  if (assertion.kind === "semantic") {
    return {
      id: compiledAppMapStepId("relay-action", actionId),
      kind: "evaluate-semantic",
      input: assertion.input,
      criteria: [...assertion.criteria],
      ...compiledJudgeFields(assertion),
    };
  }
  return {
    id: compiledAppMapStepId("relay-action", actionId),
    kind: "assert-content",
    input: assertion.input,
    expected: assertion.expected,
    match: assertion.match,
  };
}

function semanticRevealPlans(
  map: AppMap,
  screenId: string | undefined,
  target: StepTarget,
): SemanticRevealPlan[] {
  const screen = screenId ? map.screens[screenId] : undefined;
  if (!screen) return [];
  const plans: SemanticRevealPlan[] = [];
  for (const variantId of screen.variantIds) {
    const surfaces = [...(map.screenVariants[variantId]?.scrollSurfaces ?? [])].sort(
      (left, right) => right.capturedAt - left.capturedAt,
    );
    const surface = surfaces.find((candidate) =>
      candidate.semanticIndex?.anchors.some((anchor) =>
        semanticTargetMatches(target, anchor.target),
      ),
    );
    if (!surface?.semanticIndex) continue;
    const targetAnchor = surface.semanticIndex.anchors.find((anchor) =>
      semanticTargetMatches(target, anchor.target),
    );
    if (!targetAnchor) continue;
    plans.push({
      ...structuredClone(surface.semanticIndex),
      surfaceId: surface.id,
      captureId: surface.captureId,
      targetOrder: targetAnchor.order,
      targetDocumentY: targetAnchor.documentY,
    });
  }
  return plans;
}

function destEndOpenChromeTarget(step: RecipeStep): StepTarget | undefined {
  if (step.kind === "wait-for") return step.target;
  return undefined;
}

function destEndOpenFallbackTarget(step: RecipeStep): StepTarget | undefined {
  if (step.kind === "tap") return step.target;
  return undefined;
}

/** Dest-end wait-for origin + opener tap SOS when leftover is already the
 * overlay (open sidebar hides the composer). Skip the open prefix when later
 * dest chrome is already on screen — do not tap the opener, which would close
 * it, and do not re-tap a peek that is already open. */
function applyDestEndOpenLeftoverPolicy(
  steps: RecipeStep[],
  start = 0,
  end = steps.length,
): void {
  const originIndex = steps.findIndex(
    (step, index) =>
      index >= start &&
      index < end &&
      step.kind === "wait-for" &&
      step.optional !== true &&
      step.when === undefined,
  );
  if (originIndex < 0 || originIndex + 1 >= end) return;
  const origin = steps[originIndex];
  const opener = steps[originIndex + 1];
  if (origin?.kind !== "wait-for" || opener?.kind !== "tap" || opener.when) return;
  let destIndex = -1;
  let destTarget: StepTarget | undefined;
  for (let index = originIndex + 2; index < end; index += 1) {
    const later = destEndOpenChromeTarget(steps[index]!);
    if (!later) continue;
    if (semanticTargetMatches(later, origin.target)) continue;
    if (semanticTargetMatches(later, opener.target)) continue;
    destIndex = index;
    destTarget = later;
    break;
  }
  if (!destTarget) {
    for (let index = originIndex + 2; index < end; index += 1) {
      const later = destEndOpenFallbackTarget(steps[index]!);
      if (!later) continue;
      if (semanticTargetMatches(later, origin.target)) continue;
      if (semanticTargetMatches(later, opener.target)) continue;
      destIndex = index;
      destTarget = later;
      break;
    }
  }
  if (!destTarget || destIndex < 0) return;
  const when = { target: structuredClone(destTarget), condition: "absent" as const };
  for (let index = originIndex; index < destIndex; index += 1) {
    const step = steps[index]!;
    if ((step.kind !== "wait-for" && step.kind !== "tap") || step.when) continue;
    step.when = structuredClone(when);
  }
}

function connectionActionsStartWithWaitFor(connection: Connection | undefined): boolean {
  const first = connection?.actions[0];
  if (!first) return false;
  if (first.kind === "steps" || first.kind === "recorded") {
    return first.steps[0]?.kind === "wait-for";
  }
  return false;
}

function actionSteps(map: AppMap, action: ActionSpec, sourceScreenId?: string): RecipeStep[] {
  const steps: RecipeStep[] = (() => {
    switch (action.kind) {
      case "recorded":
        return action.steps.map((step, index) => stableStep(step, action.id, index));
      case "steps":
        return action.steps.map((step, index) => stableStep(step, action.id, index));
      case "tap":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "tap",
            target: structuredClone(action.target),
            ...(action.expectedApp ? { expectedApp: action.expectedApp } : {}),
            ...(action.fallbackTargets?.length
              ? { fallbackTargets: structuredClone(action.fallbackTargets) }
              : {}),
          },
        ];
      case "text":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "type",
            text: action.text,
            ...(action.target ? { target: structuredClone(action.target) } : {}),
          },
        ];
      case "gesture":
        return action.gesture.kind === "swipe"
          ? [
              {
                id: compiledAppMapStepId("relay-action", action.id),
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
                id: compiledAppMapStepId("relay-action", action.id),
                kind: "scroll",
                direction: action.gesture.direction,
                ...(action.gesture.amount === undefined ? {} : { amount: action.gesture.amount }),
              },
            ];
      case "reveal": {
        const navigation = semanticRevealPlans(map, sourceScreenId, action.target);
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "reveal",
            target: structuredClone(action.target),
            ...(action.direction ? { direction: action.direction } : {}),
            ...(action.maxAttempts === undefined ? {} : { maxAttempts: action.maxAttempts }),
            ...(navigation.length ? { navigation } : {}),
          },
        ];
      }
      case "back":
      case "home":
        return [
          { id: compiledAppMapStepId("relay-action", action.id), kind: "key", key: action.kind },
        ];
      case "app":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "app",
            action: action.action,
            ...(action.app ? { app: action.app } : {}),
            ...(action.action === "open" && action.url ? { url: action.url } : {}),
            ...(action.action === "open" && action.relaunch !== undefined
              ? { relaunch: action.relaunch }
              : {}),
          },
        ];
      case "wait":
        return action.ms === 0
          ? []
          : [
              {
                id: compiledAppMapStepId("relay-action", action.id),
                kind: "sleep",
                ms: action.ms,
              },
            ];
      case "assertion":
        return [assertionStep(map, action.id, action.assertion)];
      case "routine":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "module",
            recipeId: recipeId(map, "routine", action.routineId),
            ...(action.bindings ? { bindings: structuredClone(action.bindings) } : {}),
          },
        ];
      case "passive":
        return [];
    }
  })();
  return steps.map((step) => {
    const navigation =
      step.kind === "reveal" && !step.navigation?.length
        ? semanticRevealPlans(map, sourceScreenId, step.target)
        : [];
    return {
      ...step,
      ...(navigation.length ? { navigation } : {}),
      ...(action.optional ? { optional: true as const } : {}),
      ...(action.when ? { when: structuredClone(action.when) } : {}),
    };
  });
}

function compileRecipe(input: {
  map: AppMap;
  id: string;
  title: string;
  description?: string;
  parameters?: Routine["parameters"];
  ownerKind: "connection" | "routine";
  ownerId: string;
  sourceScreenId?: string;
  actions: ActionSpec[];
  ensureRoutine?: (routineId: string) => void;
}): AppMapCompiledRecipe {
  const steps: RecipeStep[] = [];
  const stepProvenance: AppMapCompiledStepProvenance[] = [];
  for (const action of input.actions) {
    if (action.kind === "routine") input.ensureRoutine?.(action.routineId);
    for (const step of actionSteps(input.map, action, input.sourceScreenId)) {
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

function navigationTarget(
  target: NonNullable<Connection["navigation"]>["targetAlternatives"][number],
): StepTarget {
  switch (target.kind) {
    case "identifier":
      return { identifier: target.identifier };
    case "accessibility":
      return { label: target.label, ...(target.role ? { role: target.role } : {}) };
    case "element-relative":
      return {
        point: {
          x: 0,
          y: 0,
          relativeTo: {
            target: structuredClone(target.anchor),
            xRatio: target.xRatio,
            yRatio: target.yRatio,
          },
        },
      };
  }
}

function navigationStep(connection: Connection): Extract<RecipeStep, { kind: "tap" }> | undefined {
  const contract = connection.navigation;
  if (!contract) return undefined;
  const [primary, ...fallbacks] = contract.targetAlternatives.map(navigationTarget);
  if (!primary) return undefined;
  return {
    id: compiledAppMapStepId("relay-navigation", connection.id),
    kind: "tap",
    target: primary,
    ...(fallbacks.length ? { fallbackTargets: fallbacks } : {}),
    navigationContract: {
      connectionId: connection.id,
      expectedScreenId: contract.expectedDestination.screenId,
      expectedFingerprint: contract.expectedDestination.identity.fingerprint,
      evidenceIds: [...contract.expectedDestination.evidenceIds],
    },
  };
}

function destinationExpectation(map: AppMap, connection: Connection): RecipeStep {
  const destination =
    map.screens[
      (connection.destination as Extract<Connection["destination"], { kind: "screen" }>).screenId
    ]!;
  const hasOutgoingConnection = Object.values(map.connections).some(
    (candidate) => candidate.fromScreenId === destination.id && candidate.state !== "draft",
  );
  return screenExpectation(
    map,
    connection.navigation
      ? {
          ...destination,
          identity: structuredClone(connection.navigation.expectedDestination.identity),
        }
      : destination,
    compiledAppMapStepId("relay-destination", connection.id),
    destination.evidenceSurface ?? (hasOutgoingConnection ? "ordinary" : "dead-end"),
  );
}

/** Compile one saved flow into the exact recipes consumed by the runner. */
export function compileAppMapFlow(
  mapInput: AppMap,
  flowId: string,
  options: { throughConnectionId?: string } = {},
): AppMapCompiledFlow {
  const map = validateAppMap(mapInput);
  const flow = map.flows[flowId];
  if (!flow) fail("missing-flow", `Flow "${flowId}" does not exist`);
  const throughConnectionIndex = options.throughConnectionId
    ? flow.connectionIds.indexOf(options.throughConnectionId)
    : flow.connectionIds.length - 1;
  if (options.throughConnectionId && throughConnectionIndex < 0) {
    fail(
      "missing-connection",
      `Connection "${options.throughConnectionId}" is not part of flow "${flowId}"`,
    );
  }
  const connectionIds = flow.connectionIds.slice(0, throughConnectionIndex + 1);

  const recipes: Record<string, AppMapCompiledRecipe> = {};
  const ensureRoutine = routineCompiler(map, recipes);

  const rootRecipeId = recipeId(map, "flow", flow.id);
  const root: AppMapCompiledRecipe = {
    id: rootRecipeId,
    title: `${map.name} · ${flow.name}`,
    parameters: [],
    steps: [],
    stepProvenance: [],
  };
  if (flow.setup) {
    ensureRoutine(flow.setup.routineId);
    const step = {
      id: compiledAppMapStepId("relay-setup", flow.id),
      kind: "module" as const,
      recipeId: recipeId(map, "routine", flow.setup.routineId),
      ...(flow.setup.bindings ? { bindings: structuredClone(flow.setup.bindings) } : {}),
    };
    root.steps.push(step);
    root.stepProvenance.push({
      recipeId: rootRecipeId,
      stepIndex: 0,
      stepId: step.id,
      origin: "setup",
      ownerKind: "flow",
      ownerId: flow.id,
    });
  }
  const source = map.screens[flow.startScreenId]!;
  const firstConnection = connectionIds[0] ? map.connections[connectionIds[0]] : undefined;
  // Dest-end chrome that starts with wait-for must not require the origin
  // fingerprint. compileAppMapConnection already skips that identity; the
  // Test/Flow compiler has to skip it too or leftover origin chrome SOS.
  if (!connectionActionsStartWithWaitFor(firstConnection)) {
    const sourceStep = screenExpectation(
      map,
      source,
      compiledAppMapStepId("relay-source", flow.id),
    );
    const sourceStepIndex = root.steps.length;
    root.steps.push(sourceStep);
    root.stepProvenance.push({
      recipeId: rootRecipeId,
      stepIndex: sourceStepIndex,
      stepId: sourceStep.id!,
      origin: "source",
      ownerKind: "flow",
      ownerId: flow.id,
    });
  }
  const connections: AppMapCompiledFlow["connections"] = [];
  const caseStackIds = new Set<string>();
  let terminal: AppMapCompiledFlow["terminal"] = {
    kind: "screen",
    screenId: flow.startScreenId,
  };

  for (let connectionIndex = 0; connectionIndex < connectionIds.length; connectionIndex += 1) {
    const connection = map.connections[connectionIds[connectionIndex]!]!;
    if (connection.state !== "ready") {
      fail(
        "draft-connection",
        `Connection "${connection.label?.trim() || connection.id}" is still a draft`,
      );
    }
    const rangeStart = root.steps.length;
    const contractStep = navigationStep(connection);
    if (contractStep) {
      root.steps.push(contractStep);
      root.stepProvenance.push({
        recipeId: rootRecipeId,
        stepIndex: rangeStart,
        stepId: contractStep.id!,
        origin: "action",
        ownerKind: "connection",
        ownerId: connection.id,
        actionId: "navigation-contract",
      });
    }
    const compiled = compileRecipe({
      map,
      id: rootRecipeId,
      title: root.title,
      ownerKind: "connection",
      ownerId: connection.id,
      sourceScreenId: connection.fromScreenId,
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
      const stepIndex = root.steps.length;
      const step = destinationExpectation(map, connection);
      let scrollIndex = -1;
      for (let index = rangeStart; index < root.steps.length; index += 1) {
        if (root.steps[index]?.kind === "scroll") scrollIndex = index;
      }
      const scrollStep = root.steps[scrollIndex];
      if (scrollStep?.kind === "scroll" && step.kind === "expect-screen") {
        root.steps[scrollIndex] = {
          ...scrollStep,
          until: {
            screenId: step.screenId,
            screenTitle: step.screenTitle,
            fingerprint: step.fingerprint,
            ...(step.aliases?.length ? { aliases: [...step.aliases] } : {}),
            ...(step.observations?.length
              ? { observations: structuredClone(step.observations) }
              : {}),
          },
          maxAttempts: 12,
        };
      }
      root.steps.push(step);
      root.stepProvenance.push({
        recipeId: rootRecipeId,
        stepIndex,
        stepId: step.id!,
        origin: "destination",
        ownerKind: "connection",
        ownerId: connection.id,
      });
    } else {
      applyDestEndOpenLeftoverPolicy(root.steps, rangeStart);
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
    flow: {
      id: flow.id,
      name: flow.name,
      startScreenId: flow.startScreenId,
      ...(flow.setup ? { setup: structuredClone(flow.setup) } : {}),
    },
    rootRecipeId,
    recipes,
    connections,
    caseStacks: [...caseStackIds]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => structuredClone(map.caseStacks[id]!)),
    terminal,
  };
}

/** Compile a single canonical connection for focused replay from the UI, CLI,
 * HTTP, or MCP. The source and destination are verified around the exact same
 * ActionSpecs used by full-flow execution. */
export function compileAppMapConnection(
  mapInput: AppMap,
  connectionId: string,
): AppMapCompiledConnectionRun {
  const map = validateAppMap(mapInput);
  const connection = map.connections[connectionId];
  if (!connection) fail("missing-connection", `Connection "${connectionId}" does not exist`);
  if (connection.state !== "ready") {
    fail(
      "draft-connection",
      `Connection "${connection.label?.trim() || connection.id}" is still a draft`,
    );
  }

  const recipes: Record<string, AppMapCompiledRecipe> = {};
  const ensureRoutine = routineCompiler(map, recipes);
  const rootRecipeId = recipeId(map, "connection", connection.id);
  const source = map.screens[connection.fromScreenId]!;
  const sourceStep = screenExpectation(
    map,
    source,
    compiledAppMapStepId("relay-source", connection.id),
  );
  const root: AppMapCompiledRecipe = {
    id: rootRecipeId,
    title: connection.label?.trim() || `${source.title} transition`,
    parameters: [],
    steps: [sourceStep],
    stepProvenance: [
      {
        recipeId: rootRecipeId,
        stepIndex: 0,
        stepId: sourceStep.id!,
        origin: "source",
        ownerKind: "connection",
        ownerId: connection.id,
      },
    ],
  };
  const compiled = compileRecipe({
    map,
    id: rootRecipeId,
    title: root.title,
    ownerKind: "connection",
    ownerId: connection.id,
    sourceScreenId: connection.fromScreenId,
    actions: connection.actions,
    ensureRoutine,
  });
  // Wait-for as the first action is the origin proof. Requiring origin
  // identity strands leftover conversation after a reply (open chat is no
  // longer empty home), then SOS-recovers by replaying the same connection.
  if (connectionActionsStartWithWaitFor(connection) || compiled.steps[0]?.kind === "wait-for") {
    root.steps = [];
    root.stepProvenance = [];
  }
  const contractStep = navigationStep(connection);
  if (contractStep) {
    root.steps.push(contractStep);
    root.stepProvenance.push({
      recipeId: rootRecipeId,
      stepIndex: root.steps.length - 1,
      stepId: contractStep.id!,
      origin: "action",
      ownerKind: "connection",
      ownerId: connection.id,
      actionId: "navigation-contract",
    });
  }
  for (let index = 0; index < compiled.steps.length; index += 1) {
    const stepIndex = root.steps.length;
    root.steps.push(compiled.steps[index]!);
    root.stepProvenance.push({ ...compiled.stepProvenance[index]!, stepIndex });
  }
  if (connection.destination.kind === "screen") {
    const step = destinationExpectation(map, connection);
    root.stepProvenance.push({
      recipeId: rootRecipeId,
      stepIndex: root.steps.length,
      stepId: step.id!,
      origin: "destination",
      ownerKind: "connection",
      ownerId: connection.id,
    });
    root.steps.push(step);
  } else {
    applyDestEndOpenLeftoverPolicy(root.steps);
  }
  recipes[rootRecipeId] = root;

  return {
    schemaVersion: 1,
    appMapId: map.id,
    appMapRevision: map.revision,
    connection: {
      id: connection.id,
      fromScreenId: connection.fromScreenId,
      destination: structuredClone(connection.destination),
      ...(connection.label ? { label: connection.label } : {}),
      ...(connection.caseStackId ? { caseStackId: connection.caseStackId } : {}),
    },
    rootRecipeId,
    recipes,
    caseStacks: connection.caseStackId
      ? [structuredClone(map.caseStacks[connection.caseStackId]!)]
      : [],
    terminal: structuredClone(connection.destination),
  };
}

/** Compile one approved Routine without manufacturing a Flow or Connection. */
export function compileAppMapRoutine(
  map: AppMap,
  routineId: string,
): { rootRecipeId: string; recipes: Record<string, AppMapCompiledRecipe> } {
  validateAppMap(map);
  if (!map.routines[routineId]) fail("missing-routine", `Routine ${routineId} does not exist`);
  const recipes: Record<string, AppMapCompiledRecipe> = {};
  routineCompiler(map, recipes)(routineId);
  return { rootRecipeId: recipeId(map, "routine", routineId), recipes };
}
