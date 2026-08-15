import type {
  AppMap,
  AppMapCompiledFlow,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTestStepProvenance,
  RecipeStep,
} from "@relay/protocol";
import { assertScenarioTest } from "./app-map/test-intent-validation.js";
import { compileAppMapFlow, compileAppMapRoutine } from "./app-map-compiler.js";
import { warmCompiledFlowGraphFromSharedPrefix } from "./app-map-itinerary.js";
import { validateAppMap } from "./app-map.js";
import type { Recipe } from "./recipes.js";

export type AppMapTestCompileErrorCode =
  | "unresolved-step"
  | "missing-reference"
  | "draft-connection"
  | "compiled-step-limit";

export class AppMapTestCompileError extends Error {
  constructor(
    readonly code: AppMapTestCompileErrorCode,
    readonly testId: string,
    readonly stepId: string,
    message: string,
  ) {
    super(message);
    this.name = "AppMapTestCompileError";
  }
}

const MAX_COMPILED_STEPS = 4_096;

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

export function compileAppMapScenarioTest(
  map: AppMap,
  test: AppMapScenarioTest,
): { root: Recipe; graph: Record<string, Recipe>; plan: AppMapCompiledTest } {
  validateAppMap(map);
  assertScenarioTest(test, `Test ${test.id}`);
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
  const graph: Record<string, Recipe> = {};
  const provenance: AppMapTestStepProvenance[] = [];
  const scheduledLogicalSurfaces = new Set<string>();
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
    return {
      kind: "screenshot",
      caption: `screen:${map.screens[screenId]?.title ?? screenId}`,
    };
  };
  const captureLogicalSurface = (
    screenId: string,
    options: { schedule?: boolean } = { schedule: true },
  ): RecipeStep | undefined => {
    const schedule = options.schedule !== false;
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
    if (!baseline) return undefined;
    if (schedule) scheduledLogicalSurfaces.add(screenId);
    return {
      kind: "capture-surface",
      screenId,
      screenTitle: map.screens[screenId]?.title ?? screenId,
      variantId: binding.variantId,
      surfaceId: binding.surfaceId,
      baselineCaptureId: binding.baselineCaptureId,
      reason: binding.reason,
      maxScrolls: Math.max(1, Math.min(6, baseline.viewports.length + 1)),
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
    const recoveryGroupId = `${test.id}:${suffix}:shared-origin`;
    for (const step of steps) {
      if (step.binding.status === "unresolved") {
        fail("unresolved-step", test, step, `${step.intent}: ${step.binding.reason}`);
      }
      const start = recipeSteps.length;
      const referencedEntityIds: string[] = [];
      switch (step.kind) {
        case "instruction": {
          campaignSetupSteps ??= structuredClone(recipeSteps);
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
              ...map,
              flows: {
                ...map.flows,
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
          const coldRoot = instructionGraph[plan.rootRecipeId]
            ? structuredClone(instructionGraph[plan.rootRecipeId])
            : undefined;
          if (previousInstructionPlan) {
            instructionGraph = warmCompiledFlowGraphFromSharedPrefix(
              map,
              instructionGraph,
              plan,
              previousInstructionPlan,
              previousTerminalScreenId,
              { restoreParentViewport: false },
            );
          }
          const terminalConnectionId = plan.connections.at(-1)?.connectionId;
          const decorateRecipe = (recipe: Recipe, recoveryAlternative = false): Recipe => ({
            ...recipe,
            steps: recipe.steps.flatMap((recipeStep) => {
              if (recipeStep.kind !== "expect-screen") return [recipeStep];
              const sourceExpectation =
                recipeStep.id?.startsWith("relay-source-") === true ||
                recipeStep.id?.endsWith(":warm") === true ||
                recipeStep.recovery !== undefined;
              // Source assertions guide navigation; they are not product
              // evidence. Destination assertions remain mandatory and own
              // the reviewable frame for every visited target.
              const capture = sourceExpectation ? undefined : captureScreen(recipeStep.screenId);
              const logicalSurface =
                terminalConnectionId &&
                recipeStep.id === `relay-destination-${terminalConnectionId}`
                  ? captureLogicalSurface(recipeStep.screenId, {
                      schedule: !recoveryAlternative,
                    })
                  : undefined;
              return [
                recipeStep,
                ...(capture ? [capture] : []),
                ...(logicalSurface ? [logicalSurface] : []),
              ];
            }),
          });
          for (const [recipeKey, recipe] of Object.entries(instructionGraph)) {
            instructionGraph[recipeKey] = decorateRecipe(recipe);
          }
          let recoveryRecipeId: string | undefined;
          if (previousInstructionPlan && campaignSetupSteps.length > 0 && coldRoot) {
            recoveryRecipeId = `${plan.rootRecipeId}:recover`;
            const decoratedColdRoot = decorateRecipe(coldRoot, true);
            instructionGraph[recoveryRecipeId] = {
              ...decoratedColdRoot,
              id: recoveryRecipeId,
              title: `${decoratedColdRoot.title} · canonical recovery`,
              steps: [...structuredClone(campaignSetupSteps), ...decoratedColdRoot.steps],
            };
          }
          importRecipes(step, instructionGraph, step.binding.connectionIds);
          recipeSteps.push({
            kind: "module",
            recipeId: plan.rootRecipeId,
            check: {
              id: step.id,
              title: step.intent,
              ...(recoveryRecipeId
                ? { recovery: { groupId: recoveryGroupId, recipeId: recoveryRecipeId } }
                : {}),
            },
          });
          referencedEntityIds.push(...step.binding.connectionIds);
          previousInstructionPlan = plan;
          const terminal = plan.connections.at(-1)?.destination;
          previousTerminalScreenId =
            terminal?.kind === "screen" ? terminal.screenId : plan.flow.startScreenId;
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
      if (step.capture) {
        recipeSteps.push({ kind: "screenshot", caption: `step:${step.id}:${step.intent}` });
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
    if (suffix === "root" && test.capture?.mode === "final-screen") {
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
  const root = graph[rootRecipeId]!;
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
    surfaceBindings: structuredClone(test.surfaceBindings ?? []),
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
  };
  return { root, graph, plan };
}

function assertionRecipeStep(
  map: AppMap,
  test: AppMapScenarioTest,
  step: AppMapScenarioTestStep,
  assertion: Extract<AppMapScenarioTestStep, { kind: "validation" }> extends { binding: infer B }
    ? B extends { status: "resolved"; kind: "assertion"; assertion: infer A }
      ? A
      : never
    : never,
): RecipeStep {
  if (assertion.kind === "screen") {
    const screen = map.screens[assertion.screenId];
    if (!screen)
      fail("missing-reference", test, step, `Screen ${assertion.screenId} does not exist`);
    if (!screen.identity) {
      fail(
        "missing-reference",
        test,
        step,
        `Screen ${assertion.screenId} has no approved identity`,
      );
    }
    const observations = screen.variantIds.flatMap((variantId) => {
      const observation = map.screenVariants[variantId]?.observation;
      return observation?.nodes.length ? [structuredClone(observation)] : [];
    });
    return {
      kind: "expect-screen",
      screenId: screen.id,
      screenTitle: screen.title,
      fingerprint: screen.identity.fingerprint,
      timeoutMs: 5_000,
      ...(screen.identity.aliases?.length ? { aliases: [...screen.identity.aliases] } : {}),
      ...(observations.length ? { observations } : {}),
    };
  }
  if (assertion.kind === "target") {
    return {
      kind: "expect",
      target: structuredClone(assertion.target),
      condition: assertion.condition,
      ...(assertion.timeoutMs === undefined ? {} : { timeoutMs: assertion.timeoutMs }),
    };
  }
  return {
    kind: "assert-content",
    input: assertion.input,
    expected: assertion.expected,
    match: assertion.match,
  };
}
