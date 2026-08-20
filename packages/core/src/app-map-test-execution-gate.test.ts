import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest, OfflineTestPreflightReport } from "@relay/protocol";
import {
  assessAppMapTestExecutionSource,
  requireScopedAppMapTestExecutionSource,
  revalidateAppMapTestExecutionSource,
} from "./app-map-test-execution-gate.js";
import {
  createAppMapTestExecutionIntent,
  digestAppMapTestExecutionValue,
} from "./app-map-test-execution-intent.js";
import { runWithOperationContext } from "./operation-context.js";
import type { Recipe } from "./recipes.js";
import { replayInputFromPersistedRun } from "./session-job-factory.js";
import { enqueueJob } from "./session.js";

function fixture() {
  const root: Recipe = {
    id: "app-map:settings:test:smoke:root",
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
    rootRecipeId: root.id,
    recipes: {
      [root.id]: { id: root.id, title: root.title, parameters: [], steps: [] },
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
  } satisfies AppMapCompiledTest;
  const recipeGraph = { [root.id]: root };
  const preflight: OfflineTestPreflightReport = {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: plan.appMapId,
    appMapRevision: plan.appMapRevision,
    testId: plan.test.id,
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
  const intent = createAppMapTestExecutionIntent({ plan, recipeGraph, preflight });
  const source = {
    artifacts: [{ kind: "app-map-test-execution-intent", data: intent }],
    action: root.id,
    recipeId: root.id,
    recipeSnapshot: root,
    recipeGraph,
    target: { targetId: "android-1", platform: "android" as const },
  };
  return { intent, plan, root, recipeGraph, source };
}

test("recognizes only a valid typed Test intent and reproduces its frozen preflight", async () => {
  const { intent, source } = fixture();
  assert.deepEqual(assessAppMapTestExecutionSource(source), { status: "valid", intent });
  assert.deepEqual(await revalidateAppMapTestExecutionSource(source), {
    status: "valid",
    intent,
  });
  assert.deepEqual(requireScopedAppMapTestExecutionSource(source), intent);
});

test("hard-stops malformed typed and parser-valid historical Test artifacts without guessing strings", () => {
  const { plan, source } = fixture();
  const historical = {
    ...source,
    artifacts: [{ kind: "app-map-test-plan", data: plan }],
  };
  assert.equal(assessAppMapTestExecutionSource(historical).status, "review-required");
  assert.throws(() => requireScopedAppMapTestExecutionSource(historical), /needs review/u);

  const malformed = {
    ...source,
    artifacts: [{ kind: "app-map-test-execution-intent", data: { schemaVersion: 1 } }],
  };
  assert.equal(assessAppMapTestExecutionSource(malformed).status, "review-required");

  const malformedArray = {
    ...source,
    artifacts: [
      null,
      { kind: "app-map-test-execution-intent", data: { schemaVersion: 1 } },
    ] as unknown as typeof source.artifacts,
  };
  assert.deepEqual(assessAppMapTestExecutionSource(malformedArray), {
    status: "review-required",
    reason: "The Test execution intent is malformed or internally inconsistent.",
  });
  assert.throws(() => requireScopedAppMapTestExecutionSource(malformedArray), /needs review/u);

  const nonDigestible = structuredClone(source);
  const nonDigestibleIntent = nonDigestible.artifacts[0]!.data as {
    plan: { surfaceBindings?: unknown };
  };
  nonDigestibleIntent.plan.surfaceBindings = BigInt(1);
  assert.equal(assessAppMapTestExecutionSource(nonDigestible).status, "review-required");

  const untypedRecipe = {
    action: "app-map:settings:test:smoke:root",
    recipeId: "app-map:settings:test:smoke:root",
    target: { targetId: "android-1", platform: "android" as const },
  };
  assert.deepEqual(assessAppMapTestExecutionSource(untypedRecipe), {
    status: "not-app-map-test",
  });
  assert.equal(requireScopedAppMapTestExecutionSource(untypedRecipe), undefined);
});

test("replay preserves the valid immutable Test intent artifact", () => {
  const { intent, source } = fixture();
  const artifact = {
    kind: "app-map-test-execution-intent",
    capturedAt: 1,
    data: intent,
  };
  const replay = replayInputFromPersistedRun({
    id: "run-1",
    action: source.action!,
    serial: "android-1",
    platform: "android",
    title: "Smoke",
    resolvedInputs: {},
    recipeSnapshot: source.recipeSnapshot,
    recipeGraph: source.recipeGraph,
    artifacts: [artifact],
    projectId: "local",
    ownerId: "agent:test",
  });
  assert.deepEqual(replay.artifacts, [artifact]);
  assert.notEqual(replay.artifacts?.[0], artifact);
  assert.notEqual(replay.artifacts?.[0]?.data, artifact.data);
});

test("revalidation rejects an intent whose stored offline proof has drifted", async () => {
  const { source } = fixture();
  const altered = structuredClone(source);
  const intent = altered.artifacts[0]!.data as { preflight: { findings: unknown[] } };
  intent.preflight.findings.push({ severity: "warning", code: "selector-absent" });
  assert.equal(assessAppMapTestExecutionSource(altered).status, "valid");
  assert.deepEqual(await revalidateAppMapTestExecutionSource(altered), {
    status: "review-required",
    reason: "The frozen offline preflight no longer proves this Test execution.",
  });
});

test("rejects a typed Test when the frozen job graph or root has changed", () => {
  const { source } = fixture();
  const changedGraph = structuredClone(source);
  changedGraph.recipeGraph[changedGraph.recipeSnapshot.id]!.title = "Changed";
  assert.deepEqual(assessAppMapTestExecutionSource(changedGraph), {
    status: "review-required",
    reason: "The queued Test recipe no longer matches its frozen execution intent.",
  });
});

test("rejects a typed queued Test whose executable root has been removed", () => {
  const { source } = fixture();
  assert.deepEqual(
    assessAppMapTestExecutionSource({ ...source, recipeId: undefined, requireRecipeId: true }),
    {
      status: "review-required",
      reason: "The queued Test action no longer names its frozen root recipe.",
    },
  );
});

test("rejects a queued Test whose target profile loses the selected viewport identity", () => {
  const { plan, recipeGraph, root, source } = fixture();
  const scopedPlan = {
    ...structuredClone(plan),
    runtimeTargetProfile: {
      id: "android-1-1080x2400",
      targetId: "android-1",
      platform: "android" as const,
      viewport: { width: 1080, height: 2400 },
    },
  };
  const preflight: OfflineTestPreflightReport = {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: scopedPlan.appMapId,
    appMapRevision: scopedPlan.appMapRevision,
    testId: scopedPlan.test.id,
    planDigest: digestAppMapTestExecutionValue(scopedPlan),
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
  const intent = createAppMapTestExecutionIntent({
    plan: scopedPlan,
    recipeGraph,
    preflight,
  });
  const scopedSource = {
    ...source,
    artifacts: [{ kind: "app-map-test-execution-intent", data: intent }],
    recipeSnapshot: root,
    targetProfile: {
      id: "android-1-1080x2400",
      targetId: "android-1",
      source: "device" as const,
      platform: "android" as const,
      name: "Android 1",
      viewport: { width: 1080, height: 2400 },
      capabilities: [],
      observedAt: 1,
    },
  };
  assert.equal(assessAppMapTestExecutionSource(scopedSource).status, "valid");
  const mismatched = structuredClone(scopedSource);
  mismatched.targetProfile.viewport.height = 2399;
  assert.deepEqual(assessAppMapTestExecutionSource(mismatched), {
    status: "review-required",
    reason: "The queued target profile no longer matches the selected frozen evidence profile.",
  });
});

test("the canonical queue rejects an unscoped parser-valid historical Test", () => {
  const { plan, root, recipeGraph } = fixture();
  assert.throws(
    () =>
      runWithOperationContext(
        {
          schemaVersion: 1,
          actorId: "agent:test",
          actorKind: "agent",
          organizationId: "relay",
          projectId: "local",
          operationId: "job.start",
          requestId: "request-1",
          idempotencyKey: "intent-gate-queue",
          issuedAt: 1,
        },
        () =>
          enqueueJob({
            recipe: root.id,
            serial: "android-1",
            platform: "android",
            recipeSnapshot: root,
            recipeGraph,
            artifacts: [{ kind: "app-map-test-plan", capturedAt: 1, data: plan }],
          }),
      ),
    /needs review/u,
  );
});
