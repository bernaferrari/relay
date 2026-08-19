import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import type { JobInfo, PersistedRun } from "./api-types";
import {
  failureForTestRun,
  latestRunForCompiledTest,
  outcomeForTestStep,
  provenanceForTestStep,
  runEvidenceCounts,
} from "./app-map-test-evidence";

const plan: AppMapCompiledTest = {
  schemaVersion: 1,
  appMapId: "shop",
  appMapRevision: 7,
  test: { id: "checkout", name: "Checkout", kind: "scenario", intentSchemaVersion: 1 },
  rootRecipeId: "app-map:shop:test:checkout:root:r7",
  performance: {
    executableOperations: 0,
    moduleCalls: 0,
    operationCounts: {},
    screenshotCount: 0,
    destinationProofCount: 0,
  },
  startup: { mode: "cold" },
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

  test("projects root trace outcomes and evidence to the exact authored step", () => {
    const compiled: AppMapCompiledTest = {
      ...plan,
      recipes: {
        [plan.rootRecipeId]: {
          id: plan.rootRecipeId,
          title: "Checkout",
          parameters: [],
          steps: [
            { id: "open-recipe", kind: "sleep", ms: 1 },
            { id: "confirm-recipe", kind: "sleep", ms: 1 },
          ],
        },
      },
      stepProvenance: [
        {
          recipeId: plan.rootRecipeId,
          stepIndex: 0,
          recipeStepId: "open-recipe",
          testId: "checkout",
          testStepId: "open-cart",
          bindingKind: "connections",
          referencedEntityIds: ["cart"],
        },
        {
          recipeId: plan.rootRecipeId,
          stepIndex: 1,
          recipeStepId: "confirm-recipe",
          testId: "checkout",
          testStepId: "confirm",
          bindingKind: "assertion",
          referencedEntityIds: [],
        },
      ],
    };
    const run = live({
      status: "error",
      error: "Total did not match",
      failureCategory: "deterministic-assertion",
      steps: [
        {
          id: "trace-open",
          index: 0,
          kind: "sleep",
          tone: "success",
          title: "Open",
          glyphs: [],
          startedAt: 10,
          finishedAt: 12,
          durationMs: 2,
          frames: [{ path: "open.png", caption: "after", capturedAt: 12 }],
          log: "",
          status: "ok",
        },
        {
          id: "trace-confirm",
          index: 1,
          kind: "sleep",
          tone: "danger",
          title: "Confirm",
          glyphs: [],
          startedAt: 13,
          finishedAt: 16,
          durationMs: 3,
          frames: [],
          log: "assertion failed",
          status: "error",
        },
      ],
      evidence: {
        schemaVersion: 1,
        runId: "live",
        target: { kind: "device", platform: "ios" },
        startedAt: 10,
        channels: {} as NonNullable<JobInfo["evidence"]>["channels"],
        events: [
          {
            sequence: 1,
            at: 12,
            monotonicMs: 2,
            channel: "input",
            kind: "tap",
            stepId: "trace-open",
          },
        ],
      },
      artifacts: [{ kind: "tree", capturedAt: 12, data: { stepId: "trace-open", phase: "after" } }],
    });

    assert.deepEqual(outcomeForTestStep(compiled, run, "open-cart"), {
      testStepId: "open-cart",
      state: "passed",
      observedRecipeSteps: 1,
      totalRecipeSteps: 1,
      frames: 1,
      events: 1,
      artifacts: 1,
      durationMs: 2,
      latestFrame: { path: "open.png", caption: "after", capturedAt: 12 },
    });
    assert.deepEqual(failureForTestRun(compiled, run), {
      testStepId: "confirm",
      recipeStepId: "confirm-recipe",
      message: "Total did not match",
      category: "deterministic-assertion",
    });
  });

  test("does not invent nested outcomes or choose between duplicate trace indexes", () => {
    const nested: AppMapCompiledTest = {
      ...plan,
      recipes: {
        [plan.rootRecipeId]: {
          id: plan.rootRecipeId,
          title: "Checkout",
          parameters: [],
          steps: [{ id: "decision", kind: "sleep", ms: 1 }],
        },
        branch: {
          id: "branch",
          title: "Branch",
          parameters: [],
          steps: [{ id: "nested-a", kind: "sleep", ms: 1 }],
        },
      },
      stepProvenance: [
        {
          recipeId: "branch",
          stepIndex: 0,
          recipeStepId: "nested-a",
          testId: "checkout",
          testStepId: "nested-step",
          bindingKind: "script",
          referencedEntityIds: [],
        },
      ],
    };
    const duplicate = live({
      steps: [
        {
          id: "one",
          index: 0,
          kind: "sleep",
          tone: "success",
          title: "One",
          glyphs: [],
          startedAt: 1,
          finishedAt: 2,
          frames: [],
          log: "",
          status: "ok",
        },
        {
          id: "two",
          index: 0,
          kind: "sleep",
          tone: "danger",
          title: "Two",
          glyphs: [],
          startedAt: 1,
          finishedAt: 2,
          frames: [],
          log: "",
          status: "error",
        },
      ],
    });

    assert.deepEqual(outcomeForTestStep(nested, duplicate, "nested-step"), {
      testStepId: "nested-step",
      state: "unobserved",
      observedRecipeSteps: 0,
      totalRecipeSteps: 0,
      frames: 0,
      events: 0,
      artifacts: 0,
    });
  });
});
