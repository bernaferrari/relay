import type {
  AppMap,
  AppMapCompiledFlow,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTestCompileDiagnostic,
  AppMapTestStepProvenance,
  RecipeStep,
  ReviewedDocumentOriginProjection,
} from "@relay/protocol";
import { materializeCaptureReviewSlots } from "@relay/protocol";
import { assertScenarioTest } from "./app-map/test-intent-validation.js";
import {
  compileAppMapConnection,
  compileAppMapFlow,
  compileAppMapRoutine,
  destEndCaptureWaitForIndex,
  destEndConnectionsForRequirement,
} from "./app-map-compiler.js";
import {
  compiledFlowGraphFromLiveCheckpoint,
  warmCompiledFlowGraphFromSharedPrefix,
} from "./app-map-itinerary.js";
import { frozenColdCoverageEffects } from "./campaign-recovery-effects.js";
import { validateAppMap } from "./app-map.js";
import { scrollSurfaceDocumentOriginPlan } from "./app-map-scroll-surface-baseline.js";
import {
  frozenRawAccessibilitySources,
  frozenRawAccessibilityTargetProfiles,
  frozenRawAccessibilityVariants,
} from "./app-map-test-raw-accessibility.js";
import { proposeAppMapTestExecutionSchedule } from "./app-map-test-schedule.js";
import { attachMappedInboundPrelude } from "./app-map-test-inbound-prelude.js";
import { leftoverWarmConfirmationSteps } from "./leftover-origin-recovery.js";
import {
  assertCompiledExecutionQueue,
  destEndInspectScreenshotReview,
  quoteCompiledTestDuration,
  resolvedExecutionQueue,
} from "./execution-queue-compile.js";
import {
  assessIntraTestStartingState,
  assessTransitionDeclaredSource,
  throwIfUnsafeStartingState,
  UnsafeStartingStateError,
} from "./starting-state-routines.js";
import type { Recipe } from "./recipes.js";
import { testWithSelectedRouteVariant } from "./app-map-test-route-variants.js";
import { resolveScenarioTestCompileRoute } from "./app-map-test-compile-route.js";
import { compiledTestFamilyProvenance } from "./app-map-test-family-provenance.js";
import { appMapTestReturnRepairEndpoints } from "./app-map-test-return-repair.js";
import { assertionRecipeStep } from "./app-map-test-assertion.js";
import { compiledGraphPlatformBlocker } from "./recipe-platform-support.js";
import {
  AppMapTestCompileError,
  type AppMapTestCompileErrorCode,
} from "./app-map-test-compile-error.js";
import { compiledTestClaimedAbsentControl } from "./app-map-unrecorded-claimed-control.js";

export { appMapTestReturnRepairEndpoints } from "./app-map-test-return-repair.js";
export { proposeAppMapTestExecutionSchedule } from "./app-map-test-schedule.js";
export {
  AppMapTestCompileError,
  type AppMapTestCompileErrorCode,
} from "./app-map-test-compile-error.js";

const MAX_COMPILED_STEPS = 4_096;
/** Bounded automatic survey using the `target.scroll-survey.capture` default, so an every-screen Test
 * never costs more than one manual `device survey`. */
const DESTINATION_SURVEY_MAX_SCROLLS = 4;

function insertDestEndCaptureReviewScreenshot(
  recipe: { steps: RecipeStep[] },
  screenshot: RecipeStep,
): boolean {
  if (screenshot.id && recipe.steps.some((step) => step.id === screenshot.id)) return true;
  const destIndex = destEndCaptureWaitForIndex(recipe.steps);
  if (destIndex < 0) return false;
  recipe.steps.splice(destIndex + 1, 0, structuredClone(screenshot));
  return true;
}

export type AppMapTestCompileOptions = {
  /** Run-scoped startup choice. Warm preserves the current target; cold
   * requires and launches the frozen Test origin application. */
  startupMode?: "warm" | "cold";
  /** Frozen saved profile used to choose one reviewed Test implementation. */
  runtimeTargetProfile?: import("@relay/protocol").AppMapCompiledRuntimeTargetProfile;
  /** Run-scoped cache bypass for selected full-surface Test bindings. */
  forceRecaptureSurfaceScreenIds?: readonly string[];
  /** Start from a live product checkpoint instead of executing earlier setup.
   * The compiled plan begins with a fresh exact screen proof and fails closed
   * on mismatch; it never silently relaunches. */
  entryCheckpointScreenId?: string;
  /** Server-only, locally verified reviewed-origin sidecars. Without this
   * optional input pure/offline compilation remains exact-inverse. */
  reviewedDocumentOrigins?: readonly ReviewedDocumentOriginProjection[];
};

function fail(
  code: AppMapTestCompileErrorCode,
  test: AppMapScenarioTest,
  step: AppMapScenarioTestStep,
  message: string,
): never {
  throw new AppMapTestCompileError(code, test.id, step.id, message);
}

function recipeId(map: AppMap, test: AppMapScenarioTest, suffix = "root"): string {
  return `app-map:${map.id}:test:${test.id}:${suffix}:r${map.revision}`;
}

function asRecipe(
  map: AppMap,
  compiled: { id: string; title: string; description?: string; steps: RecipeStep[] },
): Recipe {
  return {
    id: compiled.id,
    title: compiled.title,
    ...(compiled.description ? { description: compiled.description } : {}),
    source: "custom",
    steps: structuredClone(compiled.steps),
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
  };
}

function compiledPerformance(
  rootRecipeId: string,
  graph: Readonly<Record<string, Recipe>>,
): AppMapCompiledTest["performance"] {
  const operationCounts: Partial<Record<RecipeStep["kind"], number>> = {};
  let moduleCalls = 0;
  const visit = (recipeId: string, stack: ReadonlySet<string>): void => {
    if (stack.has(recipeId)) return;
    const recipe = graph[recipeId];
    if (!recipe) return;
    const nextStack = new Set(stack).add(recipeId);
    for (const step of recipe.steps) {
      if (step.kind === "module") {
        moduleCalls += 1;
        visit(step.recipeId, nextStack);
        continue;
      }
      operationCounts[step.kind] = (operationCounts[step.kind] ?? 0) + 1;
    }
  };
  visit(rootRecipeId, new Set());
  return {
    executableOperations: Object.values(operationCounts).reduce(
      (total, count) => total + (count ?? 0),
      0,
    ),
    moduleCalls,
    operationCounts,
    screenshotCount: operationCounts.screenshot ?? 0,
    destinationProofCount: operationCounts["expect-screen"] ?? 0,
  };
}

export function compileAppMapScenarioTest(
  map: AppMap,
  authoredTest: AppMapScenarioTest,
  options: AppMapTestCompileOptions = {},
): { root: Recipe; graph: Record<string, Recipe>; plan: AppMapCompiledTest } {
  validateAppMap(map);
  assertScenarioTest(authoredTest, `Test ${authoredTest.id}`);
  const resolved = resolveScenarioTestCompileRoute(map, authoredTest, options.runtimeTargetProfile);
  const selectedRouteTargetProfile = resolved.selectedRouteTargetProfile;
  const selectedRouteVariant = resolved.selectedRouteVariant;
  const test = testWithSelectedRouteVariant(resolved.test, selectedRouteVariant);
  assertScenarioTest(test, `Selected Test ${test.id}`);
  try {
    throwIfUnsafeStartingState([
      ...assessIntraTestStartingState(map, test),
      ...assessTransitionDeclaredSource(map, test),
    ]);
  } catch (error) {
    if (error instanceof UnsafeStartingStateError) {
      throw new AppMapTestCompileError(
        "unsafe-starting-state",
        test.id,
        test.steps[0]?.id ?? test.id,
        error.message,
      );
    }
    throw error;
  }
  if (
    test.organizationId !== map.organizationId ||
    test.projectId !== map.projectId ||
    test.appMapId !== map.id
  ) {
    throw new AppMapTestCompileError(
      "missing-reference",
      test.id,
      test.steps[0]?.id ?? test.id,
      `Test ${test.id} does not belong to App Map ${map.id}`,
    );
  }
  const compileMap = {
    ...map,
    connections: destEndConnectionsForRequirement(map.connections, test.requirementAction),
  };
  const graph: Record<string, Recipe> = {};
  const provenance: AppMapTestStepProvenance[] = [];
  const destEndRecipeIds = new Set<string>();
  const omittedSteps: NonNullable<AppMapCompiledTest["omittedSteps"]> = [];
  const navigationDiagnostics: AppMapTestCompileDiagnostic[] = [];
  const navigationDiagnosticKeys = new Set<string>();
  const scheduledLogicalSurfaces = new Set<string>();
  const scheduledScreenCaptures = new Set<string>();
  const scheduledDestinationSurveys = new Set<string>();
  const forceRecaptureSurfaceScreenIds = new Set(options.forceRecaptureSurfaceScreenIds ?? []);
  // An `every-screen` capture policy already promises a full survey of every
  // surface the Test reaches, so a run may force a fresh survey without an
  // explicit per-screen binding. Narrower policies still require one, because
  // the binding names the baseline that a forced recapture replaces.
  const captureCoversEveryScreen = test.capture?.mode === "every-screen";
  for (const screenId of forceRecaptureSurfaceScreenIds) {
    const binding = test.surfaceBindings?.find(
      (candidate) => candidate.screenId === screenId && candidate.captureMode === "full-surface",
    );
    if (!binding && !captureCoversEveryScreen) {
      throw new AppMapTestCompileError(
        "missing-reference",
        test.id,
        test.steps[0]?.id ?? test.id,
        `Test ${test.id} has no full-surface binding for ${screenId}`,
      );
    }
  }
  let compiledCount = 0;
  const captureScreen = (screenId: string): RecipeStep | undefined => {
    const capture = test.capture;
    const mode = capture?.mode;
    if (
      mode !== "every-screen" &&
      !(capture?.mode === "checkpoints" && capture.screenIds.includes(screenId))
    ) {
      return undefined;
    }
    // `every-screen` describes logical product states, not every traversal of
    // an edge that happens to pass through the state. The destination
    // expectation already retains its fresh raster/tree for the immediately
    // following screenshot step, so one attachment is sufficient until an
    // author explicitly adds a step-level capture.
    if (scheduledScreenCaptures.has(screenId)) return undefined;
    scheduledScreenCaptures.add(screenId);
    return {
      kind: "screenshot",
      caption: `screen:${map.screens[screenId]?.title ?? screenId}`,
    };
  };
  const captureLogicalSurface = (
    screenId: string,
    captureOptions: { schedule?: boolean } = { schedule: true },
  ): RecipeStep | undefined => {
    const schedule = captureOptions.schedule !== false;
    if (schedule && scheduledLogicalSurfaces.has(screenId)) return undefined;
    const binding = test.surfaceBindings?.find(
      (candidate) => candidate.screenId === screenId && candidate.captureMode === "full-surface",
    );
    if (!binding?.surfaceId || !binding.baselineCaptureId) return undefined;
    const variant = map.screenVariants[binding.variantId];
    const baseline = variant?.scrollSurfaces?.find(
      (surface) =>
        surface.id === binding.surfaceId && surface.captureId === binding.baselineCaptureId,
    );
    if (!baseline) {
      fail(
        "missing-reference",
        test,
        test.steps[0]!,
        `Test ${test.id} binds ${screenId} as full-surface but ${binding.surfaceId}/${binding.baselineCaptureId} is not on variant ${binding.variantId}`,
      );
    }
    const baselineCompletedAndRestored =
      baseline.status === "completed" &&
      baseline.reason === "end-of-content" &&
      baseline.restoredStartViewport &&
      Boolean(baseline.composite);
    const originPlan = baselineCompletedAndRestored
      ? scrollSurfaceDocumentOriginPlan({
          appMap: map,
          screenId,
          variantId: binding.variantId,
          surface: baseline,
          reviewedDocumentOrigins: options.reviewedDocumentOrigins,
        })
      : undefined;
    const documentOrigin = originPlan?.documentOrigin;
    const baselineTrust =
      baselineCompletedAndRestored && documentOrigin ? "trusted" : "recapture-required";
    const baselineTrustReason =
      baselineTrust === "trusted"
        ? undefined
        : baselineCompletedAndRestored
          ? "Baseline does not retain an independently proven frozen first viewport, so exact inverse restoration is required."
          : `Baseline capture is ${baseline.status}/${baseline.reason}${baseline.restoredStartViewport ? "" : " and its starting viewport was not restored"}.`;
    if (schedule) scheduledLogicalSurfaces.add(screenId);
    return {
      kind: "capture-surface",
      screenId,
      screenTitle: map.screens[screenId]?.title ?? screenId,
      variantId: binding.variantId,
      surfaceId: binding.surfaceId,
      baselineCaptureId: binding.baselineCaptureId,
      reason: binding.reason,
      maxScrolls: Math.max(1, Math.min(12, baseline.viewports.length + 1)),
      baselineTrust,
      ...(baselineTrustReason ? { baselineTrustReason } : {}),
      ...(documentOrigin ? { documentOrigin: structuredClone(documentOrigin) } : {}),
      ...(originPlan?.documentOriginProof
        ? { documentOriginProof: originPlan.documentOriginProof }
        : {}),
      ...(originPlan?.reviewedDocumentOrigin
        ? { reviewedDocumentOrigin: originPlan.reviewedDocumentOrigin }
        : {}),
      ...(forceRecaptureSurfaceScreenIds.has(screenId) ? { forceRecapture: true } : {}),
      baseline: {
        ...(baseline.composite
          ? {
              compositeWidth: baseline.composite.width,
              compositeHeight: baseline.composite.height,
            }
          : {}),
        semanticNodeCount: baseline.mergedTree.nodeCount,
      },
    };
  };
  // DX 2026-08-22 (Data Controls locale QA): a Test that lands on a screen
  // the map itself declares full-surface must not make the operator
  // rediscover a destination survey with a bespoke script. The landing
  // expectation owns one bounded evidence survey, so hidden copy reaches the
  // run frames automatically. Evidence-policy gated: `every-screen` already
  // promised a full survey of every surface the Test reaches, and a
  // step-level capture is an explicit author request — no other mode gets
  // surprise scrolls on a failures-only run.
  const fullSurfaceVariantScreenIds = new Set(
    Object.values(map.screenVariants)
      .filter((variant) => variant.scrollCapturePolicy?.captureMode === "full-surface")
      .map((variant) => variant.screenId),
  );
  const captureDestinationSurvey = (
    screenId: string,
    stepCapture: boolean,
    captureOptions: { schedule?: boolean } = { schedule: true },
  ):
    | NonNullable<Extract<RecipeStep, { kind: "expect-screen" }>["destinationSurvey"]>
    | undefined => {
    const schedule = captureOptions.schedule !== false;
    if (!captureCoversEveryScreen && stepCapture !== true) return undefined;
    if (!fullSurfaceVariantScreenIds.has(screenId)) return undefined;
    // A bound full-surface comparison already surveys this destination and
    // owns its frames; never scroll the same screen twice in one landing.
    const bound = test.surfaceBindings?.some(
      (candidate) =>
        candidate.screenId === screenId &&
        candidate.captureMode === "full-surface" &&
        Boolean(candidate.surfaceId && candidate.baselineCaptureId),
    );
    if (bound) return undefined;
    if (schedule && scheduledDestinationSurveys.has(screenId)) return undefined;
    if (schedule) scheduledDestinationSurveys.add(screenId);
    return { maxScrolls: DESTINATION_SURVEY_MAX_SCROLLS };
  };

  const importRecipes = (
    step: AppMapScenarioTestStep,
    recipes: Record<
      string,
      { id: string; title: string; description?: string; steps: RecipeStep[] }
    >,
    referencedEntityIds: string | string[],
  ) => {
    const references = Array.isArray(referencedEntityIds)
      ? referencedEntityIds
      : [referencedEntityIds];
    for (const compiled of Object.values(recipes)) {
      graph[compiled.id] = asRecipe(map, compiled);
      for (const [stepIndex, recipeStep] of compiled.steps.entries()) {
        if (recipeStep.kind === "expect-screen" && recipeStep.returnRequirement) {
          const requirement = recipeStep.returnRequirement;
          const repair = appMapTestReturnRepairEndpoints(recipeStep);
          if (repair) {
            // A returnRequirement describes the reviewed forward edge that left
            // the current state. The actual requested return destination is the
            // expectation's screen, which can be an earlier ancestor than that
            // edge's immediate source (for example a repeated state in a check).
            const { sourceScreenId, destinationScreenId } = repair;
            const key = `${step.id}:${requirement.connectionId}:${sourceScreenId}:${destinationScreenId}`;
            if (!navigationDiagnosticKeys.has(key)) {
              navigationDiagnosticKeys.add(key);
              const source = map.screens[sourceScreenId]?.title ?? sourceScreenId;
              const destination = map.screens[destinationScreenId]?.title ?? destinationScreenId;
              navigationDiagnostics.push({
                code: "unresolved-return",
                severity: "blocker",
                testId: test.id,
                testStepId: step.id,
                check: step.intent,
                recipeId: compiled.id,
                recipeStepId: recipeStep.id ?? `${compiled.id}:${stepIndex + 1}`,
                connectionId: requirement.connectionId,
                sourceScreenId,
                destinationScreenId,
                suggestion: `Teach or author a reviewed return from ${source} to ${destination}, then compile the Test again.`,
                suggestedAction: {
                  kind: "teach-return",
                  appMapId: map.id,
                  fromScreenId: sourceScreenId,
                  destinationScreenId,
                  blockedConnectionId: requirement.connectionId,
                },
              });
            }
          }
        }
        provenance.push({
          recipeId: compiled.id,
          stepIndex,
          recipeStepId: recipeStep.id ?? `${compiled.id}:${stepIndex + 1}`,
          testId: test.id,
          testStepId: step.id,
          bindingKind: step.binding.status === "resolved" ? step.binding.kind : "connections",
          referencedEntityIds: references,
        });
      }
      compiledCount += compiled.steps.length;
    }
  };

  const compileSequence = (steps: AppMapScenarioTestStep[], suffix: string): string => {
    const id = recipeId(map, test, suffix);
    const recipeSteps: RecipeStep[] = [];
    let previousInstructionPlan: AppMapCompiledFlow | undefined;
    let previousTerminalScreenId: string | undefined;
    let campaignSetupSteps: RecipeStep[] | undefined;
    let pendingEntryCheckpointScreenId =
      suffix === "root" ? options.entryCheckpointScreenId : undefined;
    for (const step of steps) {
      if (step.execution?.status === "disabled") {
        omittedSteps.push({
          stepId: step.id,
          intent: step.intent,
          reason: step.execution.reason,
          repairTargetId: step.execution.repairTargetId,
        });
        continue;
      }
      if (step.binding.status === "unresolved") {
        fail("unresolved-step", test, step, `${step.intent}: ${step.binding.reason}`);
      }
      if (pendingEntryCheckpointScreenId && step.kind !== "instruction") {
        continue;
      }
      const start = recipeSteps.length;
      const referencedEntityIds: string[] = [];
      switch (step.kind) {
        case "instruction": {
          if (pendingEntryCheckpointScreenId) campaignSetupSteps ??= [];
          else campaignSetupSteps ??= structuredClone(recipeSteps);
          const warmSourceScreenId = previousTerminalScreenId;
          const connections = step.binding.connectionIds.map((connectionId) => {
            const connection = map.connections[connectionId];
            if (!connection)
              fail("missing-reference", test, step, `Connection ${connectionId} does not exist`);
            if (connection.state !== "ready")
              fail("draft-connection", test, step, `Connection ${connectionId} is not ready`);
            return connection;
          });
          const firstConnection = connections[0]!;
          const flowId = `relay-test-${test.id}-${step.id}`;
          const plan = compileAppMapFlow(
            {
              ...compileMap,
              flows: {
                ...compileMap.flows,
                [flowId]: {
                  organizationId: map.organizationId,
                  projectId: map.projectId,
                  appMapId: map.id,
                  id: flowId,
                  name: step.intent,
                  startScreenId: firstConnection.fromScreenId,
                  connectionIds: [...step.binding.connectionIds],
                  createdAt: test.createdAt,
                  updatedAt: test.updatedAt,
                },
              },
            },
            flowId,
          );
          let instructionGraph = Object.fromEntries(
            Object.values(plan.recipes).map((compiled) => [compiled.id, asRecipe(map, compiled)]),
          );
          if (pendingEntryCheckpointScreenId) {
            const live = compiledFlowGraphFromLiveCheckpoint(
              map,
              instructionGraph,
              plan,
              pendingEntryCheckpointScreenId,
            );
            if (!live) {
              // This instruction does not cross the requested checkpoint, so
              // it belongs to cold setup and is omitted from this explicit
              // warm execution plan.
              continue;
            }
            instructionGraph = live;
            previousTerminalScreenId = pendingEntryCheckpointScreenId;
            pendingEntryCheckpointScreenId = undefined;
          } else if (previousInstructionPlan) {
            instructionGraph = warmCompiledFlowGraphFromSharedPrefix(
              map,
              instructionGraph,
              plan,
              previousInstructionPlan,
              previousTerminalScreenId,
            );
          }
          const transitionDependencies = connections.map((connection) => {
            const destination = structuredClone(connection.destination);
            const destinationScreen =
              destination.kind === "screen" ? map.screens[destination.screenId] : undefined;
            return {
              connectionId: connection.id,
              originScreenId: connection.fromScreenId,
              destination,
              ...(destinationScreen?.handoff?.ownerApp
                ? { expectedApp: destinationScreen.handoff.ownerApp }
                : {}),
            };
          });
          const terminalConnectionId = plan.connections.at(-1)?.connectionId;
          const decorateRecipe = (recipe: Recipe, recoveryAlternative = false): Recipe => ({
            ...recipe,
            steps: recipe.steps.flatMap((recipeStep) => {
              if (recipeStep.kind !== "expect-screen") return [recipeStep];
              const boundedExpectation = recipeStep.recovery
                ? {
                    ...recipeStep,
                    recovery: { ...recipeStep.recovery, maxAttempts: 1 },
                  }
                : recipeStep;
              const sourceExpectation =
                recipeStep.id?.startsWith("relay-source-") === true ||
                recipeStep.id?.endsWith(":warm") === true ||
                recipeStep.recovery !== undefined;
              // Source assertions guide navigation; they are not product
              // evidence. Destination assertions remain mandatory and own
              // the reviewable frame for every visited target.
              const isTerminalDestination =
                terminalConnectionId !== undefined &&
                recipeStep.id === `relay-destination-${terminalConnectionId}`;
              const isLiveEntry = recipeStep.id?.endsWith("-live-entry") === true;
              const capture =
                (sourceExpectation && !isLiveEntry) || (!isTerminalDestination && !isLiveEntry)
                  ? undefined
                  : captureScreen(recipeStep.screenId);
              const logicalSurface =
                terminalConnectionId &&
                (recipeStep.id === `relay-destination-${terminalConnectionId}` || isLiveEntry)
                  ? captureLogicalSurface(recipeStep.screenId, {
                      schedule: !recoveryAlternative,
                    })
                  : undefined;
              const destinationSurvey =
                terminalConnectionId &&
                (recipeStep.id === `relay-destination-${terminalConnectionId}` || isLiveEntry)
                  ? captureDestinationSurvey(recipeStep.screenId, step.capture === true, {
                      schedule: !recoveryAlternative,
                    })
                  : undefined;
              return [
                destinationSurvey
                  ? { ...boundedExpectation, destinationSurvey }
                  : boundedExpectation,
                ...(capture ? [capture] : []),
                ...(logicalSurface ? [logicalSurface] : []),
              ];
            }),
          });
          // The initial saved-origin check already proves the screen before a
          // passive self-loop. Retain its destination check and capture, while
          // preserving source proofs for every mutating or later transition.
          if (suffix === "root" && start === 0 && plan.connections.length === 1) {
            const connection = map.connections[plan.connections[0]!.connectionId];
            const selfLoop =
              connection?.destination.kind === "screen" &&
              connection.fromScreenId === connection.destination.screenId &&
              connection.actions.every((action) => action.kind === "passive");
            const rootRecipe = instructionGraph[plan.rootRecipeId];
            if (
              selfLoop &&
              rootRecipe?.steps[0]?.kind === "expect-screen" &&
              rootRecipe.steps[0].id?.startsWith("relay-source-")
            ) {
              rootRecipe.steps = rootRecipe.steps.slice(1);
            }
          }
          for (const [recipeKey, recipe] of Object.entries(instructionGraph)) {
            instructionGraph[recipeKey] = decorateRecipe(recipe);
          }
          let recoveryRecipeId: string | undefined;
          let coldRecoveryRecipeId: string | undefined;
          const recoveryTransition = transitionDependencies.at(-1);
          if (campaignSetupSteps.length > 0 && recoveryTransition) {
            const connectionPlan = compileAppMapConnection(
              compileMap,
              recoveryTransition.connectionId,
            );
            for (const compiled of Object.values(connectionPlan.recipes)) {
              instructionGraph[compiled.id] = asRecipe(map, compiled);
            }
            const connectionRoot = instructionGraph[connectionPlan.rootRecipeId]!;
            recoveryRecipeId = `${id}:confirm:${recoveryTransition.connectionId}`;
            const leftoverWarmSteps = leftoverWarmConfirmationSteps(
              map,
              recoveryTransition.originScreenId,
            );
            instructionGraph[recoveryRecipeId] = {
              id: recoveryRecipeId,
              title: `${connectionRoot.title} · warm transition confirmation`,
              source: "custom",
              steps: [...leftoverWarmSteps, ...structuredClone(connectionRoot.steps)],
              createdAt: map.createdAt,
              updatedAt: map.updatedAt,
            };
            coldRecoveryRecipeId = `${id}:proposed-cold-recovery:${recoveryTransition.connectionId}`;
            instructionGraph[coldRecoveryRecipeId] = {
              id: coldRecoveryRecipeId,
              title: `${connectionRoot.title} · proposed cold recovery`,
              source: "custom",
              steps: [
                ...structuredClone(campaignSetupSteps),
                ...structuredClone(connectionRoot.steps),
              ],
              createdAt: map.createdAt,
              updatedAt: map.updatedAt,
            };
          }
          if (connections.some((connection) => connection.destination.kind === "end")) {
            destEndRecipeIds.add(plan.rootRecipeId);
            for (const recipe of Object.values(instructionGraph)) {
              destEndRecipeIds.add(recipe.id);
            }
          }
          let cleanup: NonNullable<RecipeStep["check"]>["cleanup"];
          if (step.cleanup) {
            const compiledCleanup = compileAppMapRoutine(map, step.cleanup.routineId);
            importRecipes(step, compiledCleanup.recipes, [
              step.cleanup.routineId,
              step.cleanup.terminalScreenId,
            ]);
            cleanup = {
              recipeId: compiledCleanup.rootRecipeId,
              ...(step.cleanup.bindings
                ? { bindings: structuredClone(step.cleanup.bindings) }
                : {}),
              terminalScreenId: step.cleanup.terminalScreenId,
              onCancel: step.cleanup.onCancel,
            };
          }
          importRecipes(step, instructionGraph, step.binding.connectionIds);
          const coldCoverage = frozenColdCoverageEffects({
            graph,
            coverageRecipeId: plan.rootRecipeId,
            warmRecoveryRecipeId: recoveryRecipeId,
            cleanupRecipeId: cleanup?.recipeId,
            excludedRecipeIds: [coldRecoveryRecipeId],
            destEndRecipeIds,
          });
          if (coldCoverage[0]) {
            fail(
              "cold-coverage-effect",
              test,
              step,
              `Coverage recipe ${coldCoverage[0].recipeId} contains a state-destroying effect (${coldCoverage[0].reason})`,
            );
          }
          recipeSteps.push({
            kind: "module",
            recipeId: plan.rootRecipeId,
            check: {
              id: step.id,
              title: step.intent,
              ...(warmSourceScreenId ? { warmSourceScreenId } : {}),
              transitionDependencies,
              ...(recoveryRecipeId
                ? {
                    recovery: {
                      groupId: `transition:${recoveryTransition!.connectionId}`,
                      recipeId: recoveryRecipeId,
                      transitionId: recoveryTransition!.connectionId,
                      mode: "warm-transition",
                      coldRecipeId: coldRecoveryRecipeId!,
                    },
                  }
                : {}),
              ...(cleanup ? { cleanup } : {}),
            },
          });
          referencedEntityIds.push(...step.binding.connectionIds);
          if (step.cleanup) {
            referencedEntityIds.push(step.cleanup.routineId, step.cleanup.terminalScreenId);
          }
          previousInstructionPlan = plan;
          const terminal = plan.connections.at(-1)?.destination;
          previousTerminalScreenId =
            cleanup?.terminalScreenId ??
            (terminal?.kind === "screen" ? terminal.screenId : plan.flow.startScreenId);
          break;
        }
        case "validation":
          recipeSteps.push(
            step.binding.kind === "assertion"
              ? assertionRecipeStep(map, test, step, step.binding.assertion)
              : structuredClone(step.binding.step),
          );
          if (step.binding.kind === "assertion" && step.binding.assertion.kind === "screen") {
            referencedEntityIds.push(step.binding.assertion.screenId);
          }
          break;
        case "extraction":
          recipeSteps.push({
            kind: "extract",
            as: step.binding.as,
            target: structuredClone(step.binding.target),
            ...(step.binding.role ? { role: step.binding.role } : {}),
          });
          break;
        case "manual":
          recipeSteps.push({
            kind: "pause",
            message: step.binding.message,
            ...(step.binding.reason ? { reason: step.binding.reason } : {}),
            ...(step.binding.resumeLabel ? { resumeLabel: step.binding.resumeLabel } : {}),
            ...(step.binding.timeoutMs === undefined ? {} : { timeoutMs: step.binding.timeoutMs }),
            ...(step.binding.verifyAfter
              ? { verifyAfter: structuredClone(step.binding.verifyAfter) }
              : {}),
          });
          break;
        case "module": {
          const compiled = compileAppMapRoutine(map, step.binding.routineId);
          importRecipes(step, compiled.recipes, step.binding.routineId);
          recipeSteps.push({
            kind: "module",
            recipeId: compiled.rootRecipeId,
            ...(step.binding.bindings ? { bindings: structuredClone(step.binding.bindings) } : {}),
          });
          referencedEntityIds.push(step.binding.routineId);
          break;
        }
        case "decision": {
          const thenRecipeId = compileSequence(step.thenSteps, `step:${step.id}:then`);
          const elseRecipeId = step.elseSteps?.length
            ? compileSequence(step.elseSteps, `step:${step.id}:else`)
            : undefined;
          recipeSteps.push({
            kind: "branch",
            input: step.binding.input,
            operator: step.binding.operator,
            ...(step.binding.expected === undefined ? {} : { expected: step.binding.expected }),
            thenRecipeId,
            ...(elseRecipeId ? { elseRecipeId } : {}),
          });
          break;
        }
        case "loop":
          recipeSteps.push({
            kind: "repeat",
            count: step.binding.count,
            recipeId: compileSequence(step.steps, `step:${step.id}:loop`),
          });
          break;
        case "script":
          recipeSteps.push({ kind: "script", source: step.binding.source });
          break;
      }
      if (step.capture && recipeSteps.at(-1)?.kind !== "screenshot") {
        const destEnd =
          step.kind === "instruction" &&
          step.binding.kind === "connections" &&
          step.binding.connectionIds.some(
            (connectionId) => map.connections[connectionId]?.destination.kind === "end",
          );
        if (destEnd) {
          const destModule = recipeSteps.at(-1);
          const destRecipe = destModule?.kind === "module" ? graph[destModule.recipeId] : undefined;
          const screenshot: RecipeStep = {
            kind: "screenshot",
            caption: `step:${step.id}:${step.intent}`,
            review: destEndInspectScreenshotReview(step.intent),
            id: `relay-test-${step.id}-dest`,
          };
          const seen = new Set<string>();
          const destEndRecipes = destRecipe
            ? [destRecipe, ...Object.values(graph)]
            : Object.values(graph);
          for (const recipe of destEndRecipes) {
            if (seen.has(recipe.id)) continue;
            if (recipe !== destRecipe && !destEndRecipeIds.has(recipe.id)) continue;
            seen.add(recipe.id);
            insertDestEndCaptureReviewScreenshot(recipe, screenshot);
          }
        } else {
          recipeSteps.push({
            kind: "screenshot",
            caption: `step:${step.id}:${step.intent}`,
          });
        }
      }
      for (let index = start; index < recipeSteps.length; index += 1) {
        const recipeStep = recipeSteps[index]!;
        recipeStep.id = recipeStep.id?.trim() || `relay-test-${step.id}-${index - start + 1}`;
        provenance.push({
          recipeId: id,
          stepIndex: index,
          recipeStepId: recipeStep.id,
          testId: test.id,
          testStepId: step.id,
          bindingKind: step.binding.kind,
          referencedEntityIds,
        });
      }
      compiledCount += recipeSteps.length - start;
      if (compiledCount > MAX_COMPILED_STEPS) {
        fail(
          "compiled-step-limit",
          test,
          step,
          `Test exceeds ${MAX_COMPILED_STEPS} compiled steps`,
        );
      }
    }
    if (suffix === "root" && test.capture?.mode === "final-screen" && recipeSteps.length) {
      recipeSteps.push({ kind: "screenshot", caption: `final:${test.name}` });
      compiledCount += 1;
    }
    graph[id] = {
      id,
      title: suffix === "root" ? test.name : `${test.name} · ${suffix}`,
      source: "custom",
      steps: recipeSteps,
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    };
    return id;
  };

  const rootRecipeId = compileSequence(test.steps, "root");
  if (options.entryCheckpointScreenId && !graph[rootRecipeId]?.steps.length) {
    throw new AppMapTestCompileError(
      "missing-reference",
      test.id,
      test.steps[0]?.id ?? test.id,
      `Test ${test.name} has no executable path through checkpoint ${options.entryCheckpointScreenId}`,
    );
  }
  if (navigationDiagnostics.length) {
    const first = navigationDiagnostics[0]!;
    throw new AppMapTestCompileError(
      "unresolved-navigation",
      test.id,
      first.testStepId,
      `Test ${test.name} is not ready: ${navigationDiagnostics.length} reviewed return ${navigationDiagnostics.length === 1 ? "transition is" : "transitions are"} missing. ${first.suggestion}`,
      navigationDiagnostics,
    );
  }
  attachMappedInboundPrelude(map, graph, rootRecipeId);

  if (selectedRouteTargetProfile) {
    const platformBlocker = compiledGraphPlatformBlocker(
      graph,
      selectedRouteTargetProfile.platform,
    );
    if (platformBlocker) {
      throw new AppMapTestCompileError(
        "unsupported-platform",
        test.id,
        test.steps[0]?.id ?? test.id,
        platformBlocker.reason,
      );
    }
  }

  const root = graph[rootRecipeId]!;
  const claimedAbsent = compiledTestClaimedAbsentControl(test, graph);
  if (claimedAbsent) {
    throw new AppMapTestCompileError(
      "unresolved-step",
      test.id,
      claimedAbsent.stepId,
      claimedAbsent.reason,
    );
  }
  const executionQueue = resolvedExecutionQueue(map, test);
  assertCompiledExecutionQueue(test, graph, executionQueue);
  const queueQuotes = quoteCompiledTestDuration(root, graph, executionQueue);
  const plan: AppMapCompiledTest = {
    schemaVersion: 1,
    appMapId: map.id,
    appMapRevision: map.revision,
    test: {
      id: test.id,
      name: test.name,
      kind: "scenario",
      intentSchemaVersion: test.intentSchemaVersion,
    },
    ...(options.runtimeTargetProfile
      ? { runtimeTargetProfile: structuredClone(options.runtimeTargetProfile) }
      : {}),
    testFamily: compiledTestFamilyProvenance({
      map,
      authoredTest,
      ...(selectedRouteVariant ? { selectedRouteVariant } : {}),
      ...(selectedRouteTargetProfile ? { selectedTargetProfile: selectedRouteTargetProfile } : {}),
      stepProvenance: provenance,
    }),
    surfaceBindings: structuredClone(test.surfaceBindings ?? []),
    rawAccessibilitySourcesByScreenId: frozenRawAccessibilitySources(map),
    rawAccessibilityVariantsByScreenId: frozenRawAccessibilityVariants(map),
    rawAccessibilityTargetProfiles: frozenRawAccessibilityTargetProfiles(map),
    executionSchedule: proposeAppMapTestExecutionSchedule(map, rootRecipeId, graph),
    rootRecipeId,
    recipes: Object.fromEntries(
      Object.values(graph).map((recipe) => [
        recipe.id,
        {
          id: recipe.id,
          title: recipe.title,
          ...(recipe.description ? { description: recipe.description } : {}),
          parameters: [],
          steps: structuredClone(recipe.steps),
        },
      ]),
    ),
    stepProvenance: provenance,
    ...(destEndRecipeIds.size
      ? { destEndRecipeIds: [...destEndRecipeIds].sort((left, right) => left.localeCompare(right)) }
      : {}),
    performance: compiledPerformance(rootRecipeId, graph),
    plannedSlots: materializeCaptureReviewSlots({
      recipeSteps: root.steps,
      recipes: graph,
      requirementId: test.id,
    }),
    ...(executionQueue ? { executionQueue } : {}),
    ...(queueQuotes.length ? { queueQuotes } : {}),
    startup: options.entryCheckpointScreenId
      ? { mode: "verified-checkpoint", screenId: options.entryCheckpointScreenId }
      : {
          // Dest-end wait-for is leftover origin proof. Cold relaunch on iOS
          // focuses the composer and wedges the long-lived XCTest runner.
          mode: options.startupMode ?? (destEndRecipeIds.size ? "warm" : "cold"),
        },
    ...(authoredTest.originApplication
      ? { originApplication: authoredTest.originApplication }
      : {}),
    ...(omittedSteps.length ? { omittedSteps } : {}),
  };
  return { root, graph, plan };
}
