import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapTestRouteVariant,
  AppMapTestStepProvenance,
  TargetProfile,
} from "@relay/protocol";
import { materializeCaptureReviewSlots } from "@relay/protocol";
import {
  assertCompiledExecutionQueue,
  compiledIosReadinessDurations,
  quoteCompiledTestDuration,
  resolvedExecutionQueue,
} from "./execution-queue-compile.js";
import type { Recipe } from "./recipes.js";
import { compiledTestFamilyProvenance } from "./app-map-test-family-provenance.js";
import {
  compileCaptureReviewConfiguration,
  compiledRouteVariantConfigurations,
} from "./route-variant-configuration-compile.js";
import {
  frozenRawAccessibilitySources,
  frozenRawAccessibilityTargetProfiles,
  frozenRawAccessibilityVariants,
} from "./app-map-test-raw-accessibility.js";
import { proposeAppMapTestExecutionSchedule } from "./app-map-test-schedule.js";
import { compiledPerformance } from "./app-map-test-compile-support.js";

export function compileAppMapTestPlan(input: {
  map: AppMap;
  authoredTest: AppMapScenarioTest;
  test: AppMapScenarioTest;
  selectedRouteVariant: AppMapTestRouteVariant | undefined;
  selectedRouteTargetProfile: TargetProfile | undefined;
  runtimeTargetProfile: AppMapCompiledRuntimeTargetProfile | undefined;
  entryCheckpointScreenId: string | undefined;
  startupMode: "warm" | "cold" | undefined;
  graph: Record<string, Recipe>;
  root: Recipe;
  rootRecipeId: string;
  provenance: AppMapTestStepProvenance[];
  destEndRecipeIds: Set<string>;
  omittedSteps: NonNullable<AppMapCompiledTest["omittedSteps"]>;
}): AppMapCompiledTest {
  const {
    map,
    authoredTest,
    test,
    selectedRouteVariant,
    selectedRouteTargetProfile,
    runtimeTargetProfile,
    entryCheckpointScreenId,
    startupMode,
    graph,
    root,
    rootRecipeId,
    provenance,
    destEndRecipeIds,
    omittedSteps,
  } = input;
  const executionQueue = resolvedExecutionQueue(map, test);
  assertCompiledExecutionQueue(test, graph, executionQueue);
  const queueQuotes = quoteCompiledTestDuration(root, graph, executionQueue);
  const iosReadiness = compiledIosReadinessDurations(graph, rootRecipeId);
  const captureReviewConfiguration = compileCaptureReviewConfiguration(
    map,
    authoredTest,
    selectedRouteTargetProfile,
  );
  const routeVariantConfigurations = compiledRouteVariantConfigurations(
    map,
    authoredTest,
    selectedRouteTargetProfile,
  );
  return {
    schemaVersion: 1,
    appMapId: map.id,
    appMapRevision: map.revision,
    test: {
      id: test.id,
      name: test.name,
      kind: "scenario",
      intentSchemaVersion: test.intentSchemaVersion,
    },
    ...(runtimeTargetProfile
      ? { runtimeTargetProfile: structuredClone(runtimeTargetProfile) }
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
      ...(captureReviewConfiguration ? { configuration: captureReviewConfiguration } : {}),
    }),
    ...(executionQueue ? { executionQueue } : {}),
    ...(queueQuotes.length ? { queueQuotes } : {}),
    ...(routeVariantConfigurations.length ? { routeVariantConfigurations } : {}),
    iosReadiness,
    startup: entryCheckpointScreenId
      ? { mode: "verified-checkpoint", screenId: entryCheckpointScreenId }
      : {
          // Dest-end wait-for is leftover origin proof. Cold relaunch on iOS
          // focuses the composer and wedges the long-lived XCTest runner.
          mode: startupMode ?? (destEndRecipeIds.size ? "warm" : "cold"),
        },
    ...(authoredTest.originApplication
      ? { originApplication: authoredTest.originApplication }
      : {}),
    ...(omittedSteps.length ? { omittedSteps } : {}),
  };
}
