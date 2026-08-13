import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import type { JobInfo, PersistedRun } from "./api-types";
import {
  latestRunForCompiledTest,
  provenanceForTestStep,
  runEvidenceCounts,
} from "./app-map-test-evidence";

const plan: AppMapCompiledTest = {
  schemaVersion: 1,
  appMapId: "shop",
  appMapRevision: 7,
  test: { id: "checkout", name: "Checkout", kind: "scenario", intentSchemaVersion: 1 },
  rootRecipeId: "app-map:shop:test:checkout:root:r7",
  recipes: {},
  stepProvenance: [
    {
      recipeId: "nested",
      stepIndex: 0,
      recipeStepId: "nested-a",
      testId: "checkout",
      testStepId: "confirm",
      bindingKind: "assertion",
      referencedEntityIds: [],
    },
    {
      recipeId: "root",
      stepIndex: 1,
      recipeStepId: "root-b",
      testId: "checkout",
      testStepId: "open-cart",
      bindingKind: "connections",
      referencedEntityIds: ["cart"],
    },
  ],
};

function live(overrides: Partial<JobInfo>): JobInfo {
  return {
    id: "live",
    action: plan.rootRecipeId,
    status: "running",
    queuedAt: 10,
    logs: [],
    ...overrides,
  };
}

function persisted(overrides: Partial<PersistedRun>): PersistedRun {
  return {
    id: "disk",
    action: plan.rootRecipeId,
    status: "ok",
    attempts: 1,
    dir: "/runs/disk",
    frames: [],
    steps: [],
    logs: [],
    writtenAt: 20,
    ...overrides,
  };
}

describe("graph-native Test evidence projection", () => {
  test("matches only the exact compiled root and prefers the newest observation", () => {
    const old = persisted({ finishedAt: 20 });
    const newest = live({ id: "new", startedAt: 30 });
    const unrelated = live({ id: "other", action: "app-map:shop:flow:checkout:r7", startedAt: 40 });

    assert.equal(latestRunForCompiledTest(plan, [unrelated, newest], [old])?.id, "new");
    assert.equal(latestRunForCompiledTest(undefined, [newest], [old]), undefined);
  });

  test("deduplicates a live run over its persisted catalog row", () => {
    const disk = persisted({ id: "same", finishedAt: 20 });
    const hydrated = live({ id: "same", status: "ok", finishedAt: 20, frames: [] });
    assert.equal(latestRunForCompiledTest(plan, [hydrated], [disk]), hydrated);
  });

  test("scopes provenance to the selected intent step and counts immutable evidence", () => {
    assert.deepEqual(
      provenanceForTestStep(plan, "open-cart").map((item) => item.recipeStepId),
      ["root-b"],
    );
    assert.deepEqual(
      runEvidenceCounts(
        live({
          frames: [{ path: "screen.png", caption: "after", capturedAt: 1 }],
          artifacts: [{ kind: "trace", capturedAt: 1, data: {} }],
          evidence: { events: [{ sequence: 1 }] } as JobInfo["evidence"],
        }),
      ),
      { frames: 1, events: 1, artifacts: 1 },
    );
  });
});
