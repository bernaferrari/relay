import type {
  ActionSpec,
  AppMap,
  AppMapCompiledFlow,
  AppMapCompiledConnectionRun,
  AppMapCompiledRecipe,
  AppMapCompiledStepProvenance,
  AssertionSpec,
  CaptureCoverage,
  Connection,
  RecipeStep,
  RequirementActionKind,
  Routine,
  Screen,
  SemanticRevealPlan,
  StepTarget,
} from "@relay/protocol";
import { destEndCoverageForRequirement, leftoverSkipAllowedForCoverage } from "@relay/protocol";
import { createHash } from "node:crypto";
import { validateAppMap } from "./app-map.js";
import { observeScreenIdentityForHost } from "./screen-identity.js";
import type { SnapshotNode } from "./device.js";
import { semanticTargetMatches } from "./scroll-surface-semantic-index.js";
import { compiledJudgeFields } from "./judge-assertion-fields.js";
import {
  compileRecipe as compileRecipeFromActions,
  connectionActionsStartWithWaitFor as connectionActionsStartWithWaitForFromActions,
} from "./app-map-recipe-compiler.js";
import { destinationExpectation, navigationStep } from "./app-map-navigation-compiler.js";

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
    recipes[id] = compileRecipeFromActions({
      map,
      id,
      title: routine.name,
      ...(routine.description ? { description: routine.description } : {}),
      parameters: routine.parameters,
      ownerKind: "routine",
      ownerId: routine.id,
      actions: routine.actions,
      ensureRoutine,
      assertionStep,
    });
    if (routine.requirementAction === "capture-view") {
      applyDestEndOpenLeftoverPolicy(recipes[id]!.steps, 0, recipes[id]!.steps.length, "inspect");
    } else if (routine.requirementAction === "test-action") {
      applyDestEndOpenLeftoverPolicy(
        recipes[id]!.steps,
        0,
        recipes[id]!.steps.length,
        "transition",
      );
    }
  };
  return ensureRoutine;
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
      browserTargetId: variant?.targetProfile?.targetId,
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

function destEndOpenChromeTarget(step: RecipeStep): StepTarget | undefined {
  if (step.kind === "wait-for") return step.target;
  return undefined;
}

function destEndOpenFallbackTarget(step: RecipeStep): StepTarget | undefined {
  if (step.kind !== "tap") return undefined;
  // Label-only dest chrome is often origin chrome too — grok.com "Settings"
  // stays in the signed-in tree, so leftover skip would skip the account
  // opener and then SOS tapping a non-hittable Settings node. Identifier
  // dest chrome is overlay-unique (iOS close / camera / sidebar settings).
  if (!step.target.identifier?.trim()) return undefined;
  return step.target;
}

function lastRequiredWaitForIndex(
  steps: readonly RecipeStep[],
  start: number,
  end: number,
): number {
  for (let index = end - 1; index >= start; index -= 1) {
    const step = steps[index];
    if (step?.kind === "wait-for" && step.optional !== true) return index;
  }
  return -1;
}

function destEndLeftoverDismissTapIndex(
  steps: readonly RecipeStep[],
  start: number,
  end: number,
): number {
  for (let index = start; index < end; index += 1) {
    const step = steps[index];
    if (step?.kind !== "tap") continue;
    const label = step.target.label?.trim().toLowerCase();
    if (label === "close" || label === "back") return index;
  }
  return -1;
}

function destEndPrefixPassthrough(step: RecipeStep | undefined): boolean {
  return step?.kind === "wait-for" || step?.kind === "expect" || step?.kind === "sleep";
}

/** First TAP after origin wait-for, skipping intermediate wait-for / expect / sleep. */
function destEndCausalTapIndex(
  steps: readonly RecipeStep[],
  afterIndex: number,
  end: number,
): number {
  for (let index = afterIndex; index < end; index += 1) {
    const step = steps[index];
    if (step?.kind === "tap") return index;
    if (!destEndPrefixPassthrough(step)) return -1;
  }
  return -1;
}

function destEndRequiredChromeWaitForIndex(
  steps: readonly RecipeStep[],
  origin: Extract<RecipeStep, { kind: "wait-for" }>,
  opener: Extract<RecipeStep, { kind: "tap" }>,
  start: number,
  end: number,
  mode: "first" | "last",
): number {
  let last = -1;
  for (let index = start; index < end; index += 1) {
    const step = steps[index];
    if (step?.kind !== "wait-for" || step.optional === true) continue;
    if (semanticTargetMatches(step.target, origin.target)) continue;
    if (semanticTargetMatches(step.target, opener.target)) continue;
    if (mode === "first") return index;
    last = index;
  }
  return last;
}

/** Dest-end leftover skip dest chrome: first unique wait-for after the opener.
 * Overlay waits (open sidebar) skip the opener without becoming dest-phase. */
export function destEndDestinationWaitForIndex(
  steps: readonly RecipeStep[],
  start = 0,
  end = steps.length,
): number {
  const originIndex = steps.findIndex(
    (step, index) =>
      index >= start && index < end && step.kind === "wait-for" && step.optional !== true,
  );
  if (originIndex >= 0 && originIndex + 1 < end) {
    const origin = steps[originIndex];
    const opener = steps[originIndex + 1];
    if (origin?.kind === "wait-for" && opener?.kind === "tap") {
      const firstChrome = destEndRequiredChromeWaitForIndex(
        steps,
        origin,
        opener,
        originIndex + 2,
        end,
        "first",
      );
      if (firstChrome >= 0) return firstChrome;
      for (let index = originIndex + 2; index < end; index += 1) {
        const later = destEndOpenFallbackTarget(steps[index]!);
        if (!later) continue;
        if (semanticTargetMatches(later, origin.target)) continue;
        if (semanticTargetMatches(later, opener.target)) continue;
        return index;
      }
    }
  }
  return lastRequiredWaitForIndex(steps, start, end);
}

/** Dest-end dest-phase wait-for: last required dest chrome after the opener,
 * before leftover Close/Back. Open-sidebar leftover is not dest. */
export function destEndCaptureWaitForIndex(
  steps: readonly RecipeStep[],
  start = 0,
  end = steps.length,
): number {
  const originIndex = steps.findIndex(
    (step, index) =>
      index >= start && index < end && step.kind === "wait-for" && step.optional !== true,
  );
  if (originIndex >= 0) {
    const origin = steps[originIndex];
    const openerIndex = destEndCausalTapIndex(steps, originIndex + 1, end);
    const opener = openerIndex >= 0 ? steps[openerIndex] : undefined;
    if (origin?.kind === "wait-for" && opener?.kind === "tap") {
      const leftoverDismiss = destEndLeftoverDismissTapIndex(steps, openerIndex + 1, end);
      const destEnd = leftoverDismiss >= 0 ? leftoverDismiss : end;
      const lastChrome = destEndRequiredChromeWaitForIndex(
        steps,
        origin,
        opener,
        openerIndex + 1,
        destEnd,
        "last",
      );
      if (lastChrome >= 0) return lastChrome;
    }
  }
  return destEndDestinationWaitForIndex(steps, start, end);
}

/** Dest-end wait-for origin + opener tap SOS when leftover is already the
 * overlay (open sidebar hides the composer). Skip the open prefix when later
 * dest chrome is already on screen — do not tap the opener, which would close
 * it, and do not re-tap a peek that is already open. Capture-view only; omitted
 * dest-end stays test-action so leftover Settings cannot prove the Settings tap.
 * Remapped connection.coverage is the authority — inner step inspect/transition
 * must not flip a capture-view skip or a test-action tap. */
function destEndLeftoverSkipAllowed(coverage?: CaptureCoverage): boolean {
  return leftoverSkipAllowedForCoverage(destEndCoverageForRequirement({ coverage }));
}

function destEndOriginOpener(
  steps: RecipeStep[],
  start: number,
  end: number,
):
  | {
      originIndex: number;
      origin: Extract<RecipeStep, { kind: "wait-for" }>;
      openerIndex: number;
      opener: Extract<RecipeStep, { kind: "tap" }>;
    }
  | undefined {
  const originIndex = steps.findIndex(
    (step, index) =>
      index >= start &&
      index < end &&
      step.kind === "wait-for" &&
      step.optional !== true &&
      step.when === undefined,
  );
  if (originIndex < 0) return undefined;
  const origin = steps[originIndex];
  if (origin?.kind !== "wait-for") return undefined;
  const openerIndex = destEndCausalTapIndex(steps, originIndex + 1, end);
  const opener = openerIndex >= 0 ? steps[openerIndex] : undefined;
  if (opener?.kind !== "tap") return undefined;
  return { originIndex, origin, openerIndex, opener };
}

function destEndImmediateOriginOpener(
  steps: RecipeStep[],
  start: number,
  end: number,
):
  | {
      originIndex: number;
      origin: Extract<RecipeStep, { kind: "wait-for" }>;
      opener: Extract<RecipeStep, { kind: "tap" }>;
    }
  | undefined {
  const originIndex = steps.findIndex(
    (step, index) =>
      index >= start &&
      index < end &&
      step.kind === "wait-for" &&
      step.optional !== true &&
      step.when === undefined,
  );
  if (originIndex < 0 || originIndex + 1 >= end) return undefined;
  const origin = steps[originIndex];
  const opener = steps[originIndex + 1];
  if (origin?.kind !== "wait-for" || opener?.kind !== "tap") return undefined;
  return { originIndex, origin, opener };
}

function stampDestEndOpenerAsTestAction(steps: RecipeStep[], start: number, end: number): void {
  const found = destEndOriginOpener(steps, start, end);
  if (!found || found.opener.when) return;
  if (!found.opener.coverage) found.opener.coverage = "transition";
}

function stripDestEndLeftoverSkip(steps: RecipeStep[], start: number, end: number): void {
  const destIndex = destEndCaptureWaitForIndex(steps, start, end);
  for (let index = start; index < end; index += 1) {
    if (index === destIndex) continue;
    const step = steps[index];
    if (!step || (step.kind !== "wait-for" && step.kind !== "tap" && step.kind !== "expect")) {
      continue;
    }
    if (step.when?.condition !== "absent") continue;
    delete step.when;
    delete step.leftoverSkip;
    if (step.kind === "tap") step.coverage = "transition";
    else if (step.coverage === "inspect") delete step.coverage;
  }
}

function destEndOpenLeftoverWhenTarget(
  steps: RecipeStep[],
  destIndex: number,
): StepTarget | undefined {
  const destStep = steps[destIndex];
  return destStep
    ? (destEndOpenChromeTarget(destStep) ?? destEndOpenFallbackTarget(destStep))
    : undefined;
}

function applyDestEndDestLeftoverSkip(steps: RecipeStep[], start: number, end: number): void {
  const found = destEndOriginOpener(steps, start, end);
  if (!found || found.opener.when) return;
  const destIndex = destEndCaptureWaitForIndex(steps, start, end);
  if (destIndex <= found.openerIndex) return;
  const destTarget = destEndOpenLeftoverWhenTarget(steps, destIndex);
  if (!destTarget) return;
  if (semanticTargetMatches(destTarget, found.origin.target)) return;
  if (semanticTargetMatches(destTarget, found.opener.target)) return;
  const when = { target: structuredClone(destTarget), condition: "absent" as const };
  for (let index = found.originIndex; index < destIndex; index += 1) {
    const step = steps[index]!;
    if ((step.kind !== "wait-for" && step.kind !== "tap" && step.kind !== "expect") || step.when) {
      continue;
    }
    step.when = structuredClone(when);
    if (step.kind === "tap") {
      step.leftoverSkip = "dest";
      step.coverage = "transition";
    } else if (step.coverage === "inspect") {
      delete step.coverage;
    }
  }
}

function applyDestEndOpenLeftoverPolicy(
  steps: RecipeStep[],
  start = 0,
  end = steps.length,
  coverage?: CaptureCoverage,
): void {
  if (!destEndLeftoverSkipAllowed(coverage)) {
    if (coverage === "transition") {
      stripDestEndLeftoverSkip(steps, start, end);
      applyDestEndDestLeftoverSkip(steps, start, end);
    }
    stampDestEndOpenerAsTestAction(steps, start, end);
    return;
  }
  const found = destEndImmediateOriginOpener(steps, start, end);
  if (!found || found.opener.when) return;
  const destIndex = destEndDestinationWaitForIndex(steps, start, end);
  if (destIndex <= found.originIndex + 1) return;
  const destTarget = destEndOpenLeftoverWhenTarget(steps, destIndex);
  if (!destTarget) return;
  const when = { target: structuredClone(destTarget), condition: "absent" as const };
  for (let index = found.originIndex; index < destIndex; index += 1) {
    const step = steps[index]!;
    if ((step.kind !== "wait-for" && step.kind !== "tap") || step.when) continue;
    step.when = structuredClone(when);
    if (!step.coverage) step.coverage = "inspect";
  }
}

export function destEndConnectionsForRequirement(
  connections: AppMap["connections"],
  requirementAction?: RequirementActionKind,
): AppMap["connections"] {
  const action = requirementAction ?? "test-action";
  let changed = false;
  const next: AppMap["connections"] = { ...connections };
  for (const [id, connection] of Object.entries(next)) {
    if (connection.destination.kind !== "end") continue;
    const resolved = destEndCoverageForRequirement({
      requirementAction: action,
      coverage: connection.coverage,
      actionCoverages: connection.actions.map((spec) => spec.coverage),
    });
    if (resolved === connection.coverage) continue;
    next[id] = { ...connection, coverage: resolved };
    changed = true;
  }
  return changed ? next : connections;
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
  if (!connectionActionsStartWithWaitForFromActions(firstConnection)) {
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
    const compiled = compileRecipeFromActions({
      map,
      id: rootRecipeId,
      title: root.title,
      ownerKind: "connection",
      ownerId: connection.id,
      sourceScreenId: connection.fromScreenId,
      actions: connection.actions,
      ensureRoutine,
      assertionStep,
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
      const step = destinationExpectation(map, connection, screenExpectation);
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
      applyDestEndOpenLeftoverPolicy(
        root.steps,
        rangeStart,
        root.steps.length,
        connection.coverage,
      );
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
  const compiled = compileRecipeFromActions({
    map,
    id: rootRecipeId,
    title: root.title,
    ownerKind: "connection",
    ownerId: connection.id,
    sourceScreenId: connection.fromScreenId,
    actions: connection.actions,
    ensureRoutine,
    assertionStep,
  });
  // Wait-for as the first action is the origin proof. Requiring origin
  // identity strands leftover conversation after a reply (open chat is no
  // longer empty home), then SOS-recovers by replaying the same connection.
  if (
    connectionActionsStartWithWaitForFromActions(connection) ||
    compiled.steps[0]?.kind === "wait-for"
  ) {
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
    const step = destinationExpectation(map, connection, screenExpectation);
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
    applyDestEndOpenLeftoverPolicy(root.steps, 0, root.steps.length, connection.coverage);
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
