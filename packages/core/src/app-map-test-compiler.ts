import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTestStepProvenance,
  RecipeStep,
} from "@relay/protocol";
import { assertScenarioTest } from "./app-map/test-intent-validation.js";
import { compileAppMapConnection, compileAppMapRoutine } from "./app-map-compiler.js";
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

  const importRecipes = (
    step: AppMapScenarioTestStep,
    recipes: ReturnType<typeof compileAppMapConnection>["recipes"],
    referencedEntityId: string,
  ) => {
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
          referencedEntityIds: [referencedEntityId],
        });
      }
      compiledCount += compiled.steps.length;
    }
  };

  const compileSequence = (steps: AppMapScenarioTestStep[], suffix: string): string => {
    const id = recipeId(map, test, suffix);
    const recipeSteps: RecipeStep[] = [];
    for (const step of steps) {
      if (step.binding.status === "unresolved") {
        fail("unresolved-step", test, step, `${step.intent}: ${step.binding.reason}`);
      }
      const start = recipeSteps.length;
      const referencedEntityIds: string[] = [];
      switch (step.kind) {
        case "instruction":
          for (const connectionId of step.binding.connectionIds) {
            const connection = map.connections[connectionId];
            if (!connection)
              fail("missing-reference", test, step, `Connection ${connectionId} does not exist`);
            if (connection.state !== "ready")
              fail("draft-connection", test, step, `Connection ${connectionId} is not ready`);
            const compiled = compileAppMapConnection(map, connectionId);
            importRecipes(step, compiled.recipes, connectionId);
            if (recipeSteps.length === 0) {
              const sourceCapture = captureScreen(connection.fromScreenId);
              if (sourceCapture) recipeSteps.push(sourceCapture);
            }
            recipeSteps.push({ kind: "module", recipeId: compiled.rootRecipeId });
            if (connection.destination.kind === "screen") {
              const destinationCapture = captureScreen(connection.destination.screenId);
              if (destinationCapture) recipeSteps.push(destinationCapture);
            }
            referencedEntityIds.push(connectionId);
          }
          break;
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
