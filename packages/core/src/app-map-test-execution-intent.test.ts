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
  } as AppMapCompiledTest;
  const recipeGraph = {
    "settings:smoke:root": {
      id: "settings:smoke:root",
      title: "Smoke",
      source: "custom",
      steps: [],
      createdAt: 1,
      updatedAt: 1,
    },
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

  // Historical sibling plan artifacts never acquire scope just by looking similar.
  assert.equal(parseAppMapTestExecutionIntent(intent.plan), undefined);
  assert.equal(
    parseAppMapTestExecutionIntentArtifact({ kind: "app-map-test-plan", data: intent }),
    undefined,
  );
});
