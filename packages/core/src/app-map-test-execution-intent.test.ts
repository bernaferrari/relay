import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest, OfflineTestPreflightReport } from "@relay/protocol";
import {
  createAppMapTestExecutionIntent,
  digestAppMapTestExecutionValue,
  parseAppMapTestExecutionIntentArtifact,
  parseAppMapTestExecutionIntent,
} from "./app-map-test-execution-intent.js";
import type { Recipe } from "./recipes.js";

function fixture(): {
  plan: AppMapCompiledTest;
  recipeGraph: Record<string, Recipe>;
  preflight: OfflineTestPreflightReport;
} {
  const root: Recipe = {
    id: "settings:smoke:root",
    title: "Smoke",
    source: "custom",
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const plan = {
    schemaVersion: 1,
    appMapId: "settings",
    appMapRevision: 7,
    test: { id: "smoke", name: "Smoke", kind: "scenario", intentSchemaVersion: 1 },
    runtimeTargetProfile: {
      id: "ipad-pt",
      targetId: "ipad-1",
      platform: "ios",
      viewport: { width: 1024, height: 1366 },
    },
    rootRecipeId: "settings:smoke:root",
    recipes: {
      "settings:smoke:root": {
        id: "settings:smoke:root",
        title: "Smoke",
        parameters: [],
        steps: [],
      },
    },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  } as AppMapCompiledTest;
  const recipeGraph = {
    "settings:smoke:root": root,
  } satisfies Record<string, Recipe>;
  const preflight: OfflineTestPreflightReport = {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: "settings",
    appMapRevision: 7,
    testId: "smoke",
    planDigest: digestAppMapTestExecutionValue(plan),
    summary: {
      recipes: 1,
      checkedSelectors: 0,
      resolvedSelectors: 0,
      unknownCursorTransitions: 0,
      reviewRequiredReturns: 0,
      blockers: 0,
      warnings: 0,
    },
    selectors: [],
    cursorTimeline: [],
    returns: [],
    findings: [],
  };
  return { plan, recipeGraph, preflight };
}

test("freezes one parser-validated Test execution intent", () => {
  const intent = createAppMapTestExecutionIntent(fixture());
  assert.deepEqual(intent.sourcePlan, {
    appMapId: "settings",
    appMapRevision: 7,
    testId: "smoke",
    rootRecipeId: "settings:smoke:root",
    digest: digestAppMapTestExecutionValue(intent.plan),
    recipeGraphDigest: digestAppMapTestExecutionValue(intent.recipeGraph),
    rootRecipeDigest: digestAppMapTestExecutionValue(intent.recipeGraph["settings:smoke:root"]),
  });
  assert.deepEqual(parseAppMapTestExecutionIntent(intent), intent);
  assert.deepEqual(
    parseAppMapTestExecutionIntentArtifact({
      kind: "app-map-test-execution-intent",
      data: intent,
    }),
    intent,
  );
});

test("rejects execution intents whose profile or source identity no longer matches the frozen plan", () => {
  const intent = createAppMapTestExecutionIntent(fixture());
  const alteredProfile = structuredClone(intent);
  alteredProfile.selectedRuntimeTargetProfile!.viewport = { width: 834, height: 1194 };
  assert.equal(parseAppMapTestExecutionIntent(alteredProfile), undefined);

  const alteredDigest = structuredClone(intent);
  alteredDigest.sourcePlan.digest = "a".repeat(64);
  assert.equal(parseAppMapTestExecutionIntent(alteredDigest), undefined);

  const alteredGraph = structuredClone(intent);
  alteredGraph.recipeGraph["settings:smoke:root"]!.title = "Different root";
  assert.equal(parseAppMapTestExecutionIntent(alteredGraph), undefined);

  const alteredGraphDigest = structuredClone(intent);
  alteredGraphDigest.sourcePlan.recipeGraphDigest = "b".repeat(64);
  assert.equal(parseAppMapTestExecutionIntent(alteredGraphDigest), undefined);

  const alteredRootDigest = structuredClone(intent);
  alteredRootDigest.sourcePlan.rootRecipeDigest = "c".repeat(64);
  assert.equal(parseAppMapTestExecutionIntent(alteredRootDigest), undefined);

  const alteredProjection = structuredClone(intent);
  alteredProjection.plan.recipes["settings:smoke:root"]!.title = "Different projection";
  assert.equal(parseAppMapTestExecutionIntent(alteredProjection), undefined);

  // Historical sibling plan artifacts never acquire scope just by looking similar.
  assert.equal(parseAppMapTestExecutionIntent(intent.plan), undefined);
  assert.equal(
    parseAppMapTestExecutionIntentArtifact({ kind: "app-map-test-plan", data: intent }),
    undefined,
  );
});

test("rejects a Test graph that could fall through to a mutable or cyclic recipe", () => {
  const missing = fixture();
  const rootId = missing.plan.rootRecipeId;
  const externalStep = { kind: "module" as const, recipeId: "not-in-frozen-graph" };
  missing.recipeGraph[rootId]!.steps = [externalStep];
  missing.plan.recipes[rootId]!.steps = [structuredClone(externalStep)];
  missing.preflight.planDigest = digestAppMapTestExecutionValue(missing.plan);
  assert.throws(
    () => createAppMapTestExecutionIntent(missing),
    /inconsistent App Map Test execution intent/u,
  );

  const cyclic = fixture();
  const recursiveStep = { kind: "module" as const, recipeId: cyclic.plan.rootRecipeId };
  cyclic.recipeGraph[cyclic.plan.rootRecipeId]!.steps = [recursiveStep];
  cyclic.plan.recipes[cyclic.plan.rootRecipeId]!.steps = [structuredClone(recursiveStep)];
  cyclic.preflight.planDigest = digestAppMapTestExecutionValue(cyclic.plan);
  assert.throws(
    () => createAppMapTestExecutionIntent(cyclic),
    /inconsistent App Map Test execution intent/u,
  );
});
