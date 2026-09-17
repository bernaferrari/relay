import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest, OfflineTestPreflightReport } from "@relay/protocol";
import { compileExecutionRisk } from "./execution-risk-compiler.js";
import {
  createAppMapTestExecutionIntent,
  parseCanonicalAppMapTestPlan,
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
    executionRisk: {
      schemaVersion: 1,
      level: "safe",
      reasons: [],
      externalEffects: [],
      confirmation: "none",
      expectedAppBoundaries: [],
      maximumActions: 0,
      maximumDurationMs: 0,
      cleanupRequired: false,
    },
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

function campaignFixture(input: {
  frozenRecipeIds: string[];
  coldRecipeId?: string;
}): ReturnType<typeof fixture> {
  const current = fixture();
  const rootId = current.plan.rootRecipeId;
  const checkedStep: Recipe["steps"][number] = {
    kind: "module",
    recipeId: "primary",
    check: {
      id: "settings",
      title: "Settings",
      recovery: {
        groupId: "settings-origin",
        recipeId: "warm-recovery",
        ...(input.coldRecipeId ? { coldRecipeId: input.coldRecipeId } : {}),
      },
      cleanup: {
        recipeId: "restore-settings",
        terminalScreenId: "settings",
        onCancel: "skip",
      },
    },
  };
  current.recipeGraph[rootId]!.steps = [checkedStep];
  current.plan.recipes[rootId]!.steps = [structuredClone(checkedStep)];
  for (const id of input.frozenRecipeIds) {
    const recipe: Recipe = {
      id,
      title: id,
      source: "custom",
      steps: [],
      createdAt: 1,
      updatedAt: 1,
    };
    current.recipeGraph[id] = recipe;
    current.plan.recipes[id] = {
      id,
      title: id,
      parameters: [],
      steps: [],
    };
  }
  current.preflight.planDigest = digestAppMapTestExecutionValue(current.plan);
  current.preflight.executionRisk = compileExecutionRisk({
    kind: "compiled-test",
    test: current.plan,
  });
  return current;
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

test("fixture Lane --lane grok-lab is stamped on the execution intent", () => {
  const intent = createAppMapTestExecutionIntent({ ...fixture(), laneId: "grok-lab" });
  assert.equal(intent.laneId, "grok-lab");
  assert.deepEqual(parseAppMapTestExecutionIntent(intent), intent);
  const unsigned = createAppMapTestExecutionIntent(fixture());
  assert.equal(unsigned.laneId, undefined);
  assert.deepEqual(parseAppMapTestExecutionIntent(unsigned), unsigned);
});

test("binds preflight execution risk to the exact frozen Test plan", () => {
  const intent = createAppMapTestExecutionIntent(fixture());
  assert.equal(intent.preflight.executionRisk.level, "safe");

  const alteredRisk = structuredClone(intent);
  alteredRisk.preflight.executionRisk.maximumActions = 1;
  assert.equal(parseAppMapTestExecutionIntent(alteredRisk), undefined);
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
  missing.preflight.executionRisk = compileExecutionRisk({
    kind: "compiled-test",
    test: missing.plan,
  });
  assert.throws(
    () => createAppMapTestExecutionIntent(missing),
    /inconsistent App Map Test execution intent/u,
  );

  const cyclic = fixture();
  const recursiveStep = { kind: "module" as const, recipeId: cyclic.plan.rootRecipeId };
  cyclic.recipeGraph[cyclic.plan.rootRecipeId]!.steps = [recursiveStep];
  cyclic.plan.recipes[cyclic.plan.rootRecipeId]!.steps = [structuredClone(recursiveStep)];
  cyclic.preflight.planDigest = digestAppMapTestExecutionValue(cyclic.plan);
  cyclic.preflight.executionRisk = compileExecutionRisk({
    kind: "compiled-test",
    test: cyclic.plan,
  });
  assert.throws(
    () => createAppMapTestExecutionIntent(cyclic),
    /inconsistent App Map Test execution intent/u,
  );
});

test("closes executable campaign cleanup and recovery recipes without freezing proposed cold repair", () => {
  const missingCleanup = campaignFixture({ frozenRecipeIds: ["primary", "warm-recovery"] });
  assert.throws(
    () => createAppMapTestExecutionIntent(missingCleanup),
    /inconsistent App Map Test execution intent/u,
  );

  const missingRecovery = campaignFixture({ frozenRecipeIds: ["primary", "restore-settings"] });
  assert.throws(
    () => createAppMapTestExecutionIntent(missingRecovery),
    /inconsistent App Map Test execution intent/u,
  );

  const proposalOnlyColdRecovery = campaignFixture({
    frozenRecipeIds: ["primary", "warm-recovery", "restore-settings"],
    coldRecipeId: "proposed-cold-repair-not-executable",
  });
  assert.doesNotThrow(() => createAppMapTestExecutionIntent(proposalOnlyColdRecovery));
});

test("canonical plans retain explicit app origins and support warm startup", () => {
  const { plan } = fixture();
  for (const mode of ["cold", "warm"] as const) {
    const candidate = { ...plan, startup: { mode }, originApplication: "com.android.settings" };
    assert.equal(
      parseCanonicalAppMapTestPlan(candidate)?.originApplication,
      "com.android.settings",
    );
    assert.equal(parseCanonicalAppMapTestPlan(candidate)?.startup.mode, mode);
  }
  assert.equal(parseCanonicalAppMapTestPlan({ ...plan, originApplication: 42 }), undefined);
  assert.equal(parseCanonicalAppMapTestPlan({ ...plan, originApplication: "" }), undefined);
});

test("canonical plans persist Fast UI queue quotes without treating them as unknown keys", () => {
  const ready = fixture();
  ready.plan.executionQueue = "fast-ui";
  ready.plan.queueQuotes = [
    {
      queue: "fast-ui",
      label: "Fast UI",
      workItemCount: 1,
      totalWorkMs: 7550,
      criticalPathMs: 7550,
      workers: 1,
      requiredDwellMs: 2000,
      lowerBoundMs: 7550,
    },
  ];
  ready.preflight.planDigest = digestAppMapTestExecutionValue(ready.plan);
  ready.preflight.executionRisk = compileExecutionRisk({
    kind: "compiled-test",
    test: ready.plan,
  });
  const intent = createAppMapTestExecutionIntent(ready);
  assert.equal(intent.plan.executionQueue, "fast-ui");
  assert.equal(intent.plan.queueQuotes?.[0]?.label, "Fast UI");
  assert.equal(
    parseCanonicalAppMapTestPlan({ ...ready.plan, queueQuotes: [{ queue: "fast-ui" }] }),
    undefined,
  );
});

test("canonical plans persist Android vs iOS vs web route configurations without treating them as unknown keys", () => {
  const ready = fixture();
  ready.plan.routeVariantConfigurations = [
    {
      platform: "web",
      configuration: { browser: "grok-com" },
      testId: "test-grok-web-signed-in-home",
      role: "compiled",
    },
    {
      platform: "android",
      configuration: { app: "android" },
      testId: "test-grok-android-home-chrome",
      role: "companion",
    },
    {
      platform: "ios",
      configuration: { app: "ai.x.GrokApp" },
      testId: "test-grok-ios-home-chrome",
      role: "companion",
    },
  ];
  ready.preflight.planDigest = digestAppMapTestExecutionValue(ready.plan);
  ready.preflight.executionRisk = compileExecutionRisk({
    kind: "compiled-test",
    test: ready.plan,
  });
  const intent = createAppMapTestExecutionIntent(ready);
  assert.equal(intent.plan.routeVariantConfigurations?.length, 3);
  assert.equal(intent.plan.routeVariantConfigurations?.[1]?.platform, "android");
  assert.equal(
    parseCanonicalAppMapTestPlan({
      ...ready.plan,
      routeVariantConfigurations: [{ platform: "android" }],
    }),
    undefined,
  );
});

test("canonical plans persist dest-wait vs runner-recover iosReadiness", () => {
  const ready = fixture();
  ready.plan.iosReadiness = {
    destWaitMs: 8_000,
    runnerRecoverMs: 0,
    productReadyMs: 8_000,
  };
  ready.preflight.planDigest = digestAppMapTestExecutionValue(ready.plan);
  ready.preflight.executionRisk = compileExecutionRisk({
    kind: "compiled-test",
    test: ready.plan,
  });
  const intent = createAppMapTestExecutionIntent(ready);
  assert.equal(intent.plan.iosReadiness?.destWaitMs, 8_000);
  assert.equal(intent.plan.iosReadiness?.runnerRecoverMs, 0);
  assert.equal(intent.plan.iosReadiness?.productReadyMs, 8_000);
  assert.equal(
    parseCanonicalAppMapTestPlan({
      ...ready.plan,
      iosReadiness: { destWaitMs: 8_000, productReadyMs: 8_000 },
    }),
    undefined,
  );
});
