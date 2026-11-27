import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMapScenarioTestStep, RecipeStep } from "@relay/protocol";
import {
  dropStaleActCachesFromRun,
  saveActCachesFromRun,
  withCache,
  withoutCache,
  type ActCacheUpdate,
} from "./app-map-act-cache.js";
import { sanitizedActCacheSteps } from "./act-cache-steps.js";
import { createAppMap, mutateStoredAppMap, readAppMap } from "../collaboration/collaboration.js";
import { resetControlDatabaseCache } from "../collaboration/collaboration-db.js";
import type { PersistedRun } from "../run/run-store.js";

function textStep(id: string, intent: string, cache?: unknown): AppMapScenarioTestStep {
  return {
    id,
    kind: "instruction",
    intent,
    binding: {
      status: "unresolved",
      reason: "r",
      fromText: true,
      ...(cache ? { cache } : {}),
    },
  } as AppMapScenarioTestStep;
}

const tap: RecipeStep = { kind: "tap", target: { label: "Settings" } };

function update(
  intent: string,
  steps: RecipeStep[] = [tap],
  missedReason?: string,
): ActCacheUpdate {
  return {
    intent,
    steps,
    resolution: [{ strategy: "label", key: "Settings" }],
    ...(missedReason ? { missedReason } : {}),
  };
}

const context = { runId: "run-1", at: 5, targetKind: "browser" as const };

test("saved actions attach only to plain-English steps whose words still match", () => {
  const steps = [
    textStep("a", "Open Settings"),
    textStep("b", "Renamed"),
    {
      id: "c",
      kind: "instruction",
      intent: "Recorded",
      binding: { status: "resolved", kind: "connections", connectionIds: ["x"] },
    } as AppMapScenarioTestStep,
  ];
  const updates = new Map([
    ["a", update("Open Settings")],
    ["b", update("Old words")],
    ["c", update("Recorded")],
  ]);
  const next = withCache(steps, updates, context);
  assert.equal(next.changed, 1);
  const cache = (next.steps[0]! as { binding: { cache?: Record<string, unknown> } }).binding.cache;
  assert.equal(cache?.schemaVersion, 2);
  assert.equal(cache?.runId, "run-1");
  assert.equal(cache?.savedAt, 5);
  assert.equal(cache?.targetKind, "browser");
  assert.deepEqual(cache?.steps, [tap]);
  assert.deepEqual(cache?.resolution, [{ strategy: "label", key: "Settings" }]);
  assert.deepEqual(cache?.verification, { runOutcome: "passed" });
  assert.equal(cache?.healedFrom, undefined);
  assert.equal((next.steps[1]! as { binding: { cache?: unknown } }).binding.cache, undefined);
});

test("a re-resolution after a miss carries the lineage of the entry it replaces", () => {
  const previous = {
    steps: [tap],
    runId: "run-0",
    savedAt: 1,
  };
  const steps = [textStep("a", "Open Settings", previous)];
  const updates = new Map([
    ["a", update("Open Settings", [tap], "tap failed: no strategy matched")],
  ]);
  const next = withCache(steps, updates, { ...context, runId: "run-2" });
  assert.equal(next.changed, 1);
  const cache = (next.steps[0]! as { binding: { cache?: Record<string, unknown> } }).binding.cache;
  assert.deepEqual(cache?.healedFrom, {
    runId: "run-0",
    savedAt: 1,
    reason: "tap failed: no strategy matched",
  });
});

test("a first resolution after a miss against a dropped entry records no lineage", () => {
  const steps = [textStep("a", "Open Settings")];
  const updates = new Map([["a", update("Open Settings", [tap], "tap failed")]]);
  const next = withCache(steps, updates, context);
  const cache = (next.steps[0]! as { binding: { cache?: Record<string, unknown> } }).binding.cache;
  assert.equal(cache?.healedFrom, undefined);
});

test("withoutCache drops saved paths only from the named steps", () => {
  const cached = { steps: [tap], runId: "run-0", savedAt: 1 };
  const steps = [
    textStep("a", "Open Settings", cached),
    textStep("b", "Checkout", cached),
    {
      id: "loop",
      kind: "loop",
      intent: "For each row",
      binding: { status: "resolved", kind: "repeat", count: 2 },
      steps: [textStep("nested", "Nested", cached)],
    } as AppMapScenarioTestStep,
  ];
  const next = withoutCache(steps, new Set(["a", "nested"]));
  assert.equal(next.changed, 2);
  assert.equal((next.steps[0]! as { binding: { cache?: unknown } }).binding.cache, undefined);
  assert.deepEqual((next.steps[1]! as { binding: { cache?: unknown } }).binding.cache, cached);
  const loop = next.steps[2] as { steps: AppMapScenarioTestStep[] };
  assert.equal((loop.steps[0]! as { binding: { cache?: unknown } }).binding.cache, undefined);
});

test("sanitizing strips coordinates keyed by a semantic name and keeps the resolution proof", () => {
  const clean = sanitizedActCacheSteps(
    [
      {
        kind: "tap",
        target: { label: "Checkout", point: { x: 10, y: 20 } },
      } as RecipeStep,
      { kind: "sleep", ms: 500 },
    ],
    [{ strategy: "label", key: "Checkout" }, null],
  );
  assert.ok(clean);
  assert.deepEqual(clean.steps[0], { kind: "tap", target: { label: "Checkout" } });
  assert.deepEqual(clean.resolution, [{ strategy: "label", key: "Checkout" }]);
});

test("point-only actions are never cached, and one bad action discards the whole path", () => {
  const pointOnly = sanitizedActCacheSteps(
    [{ kind: "tap", target: { point: { x: 10, y: 20 } } } as RecipeStep],
    [{ strategy: "point" }],
  );
  assert.equal(pointOnly, undefined);
  const semanticWithoutProof = sanitizedActCacheSteps(
    [{ kind: "tap", target: { label: "Checkout" } } as RecipeStep],
    [null],
  );
  assert.equal(semanticWithoutProof, undefined);
  const mixed = sanitizedActCacheSteps(
    [
      { kind: "tap", target: { label: "Checkout" } } as RecipeStep,
      { kind: "tap", target: { point: { x: 1, y: 1 } } } as RecipeStep,
    ],
    [{ strategy: "label", key: "Checkout" }, { strategy: "point" }],
  );
  assert.equal(mixed, undefined);
});

test("uncacheable kinds discard the whole path, including nested act steps", () => {
  for (const bad of [
    { kind: "script", source: "return 1" },
    { kind: "act", intent: "nested" },
    { kind: "module", recipeId: "x" },
    { kind: "evaluate-visual", criteria: ["x"] },
    { kind: "expect", target: { label: "x" }, condition: "visible" },
    { kind: "device", action: "lock" },
  ] as RecipeStep[]) {
    const clean = sanitizedActCacheSteps(
      [{ kind: "tap", target: { label: "Checkout" } } as RecipeStep, bad],
      [{ strategy: "label", key: "Checkout" }, null],
    );
    assert.equal(clean, undefined, `${bad.kind} must not be cacheable`);
  }
  const keys = sanitizedActCacheSteps(
    [
      { kind: "key", key: "back" },
      { kind: "device", action: "keyboard-enter" },
      { kind: "scroll", direction: "down" },
    ] as RecipeStep[],
    [null, null, null],
  );
  assert.ok(keys);
});

test("type text redacted as a private input is never cached", () => {
  const clean = sanitizedActCacheSteps(
    [
      {
        kind: "type",
        text: "[private]",
        mode: "replace",
        target: { identifier: "password" },
      } as RecipeStep,
    ],
    [null],
  );
  assert.equal(clean, undefined);
  const plain = sanitizedActCacheSteps(
    [
      {
        kind: "type",
        text: "shoes",
        mode: "replace",
        target: { identifier: "search", point: { x: 1, y: 1 } },
      } as RecipeStep,
    ],
    [null],
  );
  assert.ok(plain);
  assert.deepEqual(plain.steps[0], {
    kind: "type",
    text: "shoes",
    mode: "replace",
    target: { identifier: "search" },
  });
  assert.deepEqual(plain.resolution, [{ strategy: "identifier", key: "search" }]);
});

type RunInput = {
  outcome: PersistedRun["outcome"];
  platform?: string;
  artifacts?: PersistedRun["artifacts"];
};

function actRun(input: RunInput): PersistedRun {
  return {
    schemaVersion: 5,
    id: `run-${input.outcome}`,
    projectId: "project",
    ownerId: "owner",
    action: "app-map:map:test:checkout",
    status: input.outcome === "passed" ? "ok" : "error",
    outcome: input.outcome,
    platform: input.platform ?? "browser",
    queuedAt: 20,
    startedAt: 21,
    finishedAt: 22,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    artifacts: input.artifacts ?? [],
    dir: "/tmp/run-act",
    writtenAt: 22,
    inputDigest: "digest",
    resolvedInputs: {},
  };
}

function planArtifact() {
  return {
    kind: "app-map-test-plan",
    capturedAt: 21,
    data: {
      appMapId: "map",
      appMapRevision: 1,
      test: { id: "checkout" },
      stepProvenance: [{ recipeStepId: "relay-test-s1-1", testStepId: "s1" }],
    },
  };
}

function modelResult(steps: unknown, resolutions?: unknown) {
  return {
    kind: "act-result",
    capturedAt: 21,
    data: {
      intent: "Open Settings",
      recipeStepId: "relay-test-s1-1",
      source: "model",
      steps,
      ...(resolutions ? { resolutions } : {}),
    },
  };
}

async function withMap(steps: AppMapScenarioTestStep[], run: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-act-cache-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  try {
    await createAppMap({
      organizationId: "org",
      projectId: "project",
      appMapId: "map",
      name: "Map",
    });
    await mutateStoredAppMap("project", "map", (map) => ({
      ...map,
      tests: {
        checkout: {
          id: "checkout",
          appMapId: "map",
          organizationId: "org",
          projectId: "project",
          createdAt: 1,
          updatedAt: 1,
          name: "Checkout",
          kind: "scenario",
          intentSchemaVersion: 1,
          steps,
        },
      },
      revision: map.revision + 1,
    }));
    await run();
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    resetControlDatabaseCache();
  }
}

test(
  "a passed browser run saves a v2 path the next run can replay",
  { concurrency: false },
  async () => {
    await withMap([textStep("s1", "Open Settings")], async () => {
      const saved = await saveActCachesFromRun(
        actRun({
          outcome: "passed",
          artifacts: [
            planArtifact(),
            modelResult(
              [{ kind: "tap", target: { label: "Settings", point: { x: 3, y: 4 } } }],
              [{ strategy: "label", key: "Settings" }],
            ),
          ],
        }) as never,
      );
      assert.equal(saved, 1);
      const map = await readAppMap("project", "map");
      const step = map?.tests.checkout?.steps[0] as {
        binding: { cache?: Record<string, unknown> };
      };
      const cache = step.binding.cache;
      assert.equal(cache?.schemaVersion, 2);
      assert.equal(cache?.targetKind, "browser");
      assert.deepEqual(cache?.steps, [{ kind: "tap", target: { label: "Settings" } }]);
      assert.deepEqual(cache?.resolution, [{ strategy: "label", key: "Settings" }]);
    });
  },
);

test(
  "the outcome matrix: failed and blocked runs save nothing",
  { concurrency: false },
  async () => {
    await withMap([textStep("s1", "Open Settings")], async () => {
      for (const outcome of [
        "product-failure",
        "harness-failure",
        "uncertain",
        "cancelled",
      ] as const) {
        const saved = await saveActCachesFromRun(
          actRun({
            outcome,
            artifacts: [
              planArtifact(),
              modelResult(
                [{ kind: "tap", target: { label: "Settings" } }],
                [{ strategy: "label", key: "Settings" }],
              ),
            ],
          }) as never,
        );
        assert.equal(saved, 0, `${outcome} must not save`);
      }
      const map = await readAppMap("project", "map");
      const step = map?.tests.checkout?.steps[0] as { binding: { cache?: unknown } };
      assert.equal(step.binding.cache, undefined);
    });
  },
);

test("device runs never save a path in either direction", { concurrency: false }, async () => {
  await withMap([textStep("s1", "Open Settings")], async () => {
    const saved = await saveActCachesFromRun(
      actRun({
        outcome: "passed",
        platform: "android",
        artifacts: [
          planArtifact(),
          modelResult(
            [{ kind: "tap", target: { label: "Settings" } }],
            [{ strategy: "label", key: "Settings" }],
          ),
        ],
      }) as never,
    );
    assert.equal(saved, 0);
  });
});

test(
  "a failed run drops the saved path of steps that missed, and only those",
  { concurrency: false },
  async () => {
    const cached = {
      schemaVersion: 2,
      steps: [{ kind: "tap", target: { label: "Settings" } }],
      runId: "run-old",
      savedAt: 1,
      targetKind: "browser",
      resolution: [{ strategy: "label", key: "Settings" }],
      verification: { runOutcome: "passed" },
    };
    await withMap(
      [textStep("s1", "Open Settings", cached), textStep("s2", "Checkout", cached)],
      async () => {
        const dropped = await dropStaleActCachesFromRun(
          actRun({
            outcome: "product-failure",
            artifacts: [
              planArtifact(),
              {
                kind: "act-decision",
                capturedAt: 21,
                data: {
                  intent: "Open Settings",
                  recipeStepId: "relay-test-s1-1",
                  action: "cache-miss",
                  reason: "tap failed: no strategy matched",
                },
              },
            ],
          }) as never,
        );
        assert.equal(dropped, 1);
        const map = await readAppMap("project", "map");
        const first = map?.tests.checkout?.steps[0] as { binding: { cache?: unknown } };
        const second = map?.tests.checkout?.steps[1] as { binding: { cache?: unknown } };
        assert.equal(first.binding.cache, undefined);
        assert.ok(second.binding.cache);
        // Idempotent: projecting the same run twice changes nothing more.
        const again = await dropStaleActCachesFromRun(
          actRun({
            outcome: "product-failure",
            artifacts: [
              planArtifact(),
              {
                kind: "act-decision",
                capturedAt: 21,
                data: {
                  intent: "Open Settings",
                  recipeStepId: "relay-test-s1-1",
                  action: "cache-miss",
                  reason: "tap failed: no strategy matched",
                },
              },
            ],
          }) as never,
        );
        assert.equal(again, 0);
      },
    );
  },
);

test(
  "drops are gated on failure: passed and blocked runs keep saved paths",
  { concurrency: false },
  async () => {
    const cached = {
      schemaVersion: 2,
      steps: [{ kind: "tap", target: { label: "Settings" } }],
      runId: "run-old",
      savedAt: 1,
      targetKind: "browser",
      resolution: [{ strategy: "label", key: "Settings" }],
      verification: { runOutcome: "passed" },
    };
    await withMap([textStep("s1", "Open Settings", cached)], async () => {
      for (const outcome of ["passed", "harness-failure", "uncertain", "cancelled"] as const) {
        const dropped = await dropStaleActCachesFromRun(
          actRun({
            outcome,
            artifacts: [
              planArtifact(),
              {
                kind: "act-decision",
                capturedAt: 21,
                data: {
                  intent: "Open Settings",
                  recipeStepId: "relay-test-s1-1",
                  action: "cache-miss",
                  reason: "x",
                },
              },
            ],
          }) as never,
        );
        assert.equal(dropped, 0, `${outcome} must not drop`);
      }
      const map = await readAppMap("project", "map");
      const step = map?.tests.checkout?.steps[0] as { binding: { cache?: unknown } };
      assert.ok(step.binding.cache);
    });
  },
);

test(
  "a healing whose run passed saves the new path with its lineage",
  { concurrency: false },
  async () => {
    const cached = {
      schemaVersion: 2,
      steps: [{ kind: "tap", target: { label: "Settings" } }],
      runId: "run-old",
      savedAt: 3,
      targetKind: "browser",
      resolution: [{ strategy: "label", key: "Settings" }],
      verification: { runOutcome: "passed" },
    };
    await withMap([textStep("s1", "Open Settings", cached)], async () => {
      const saved = await saveActCachesFromRun(
        actRun({
          outcome: "passed",
          artifacts: [
            planArtifact(),
            {
              kind: "act-decision",
              capturedAt: 21,
              data: {
                intent: "Open Settings",
                recipeStepId: "relay-test-s1-1",
                action: "cache-miss",
                reason: "tap failed: no strategy matched",
              },
            },
            modelResult(
              [{ kind: "tap", target: { identifier: "settings-icon" } }],
              [{ strategy: "identifier", key: "settings-icon" }],
            ),
          ],
        }) as never,
      );
      assert.equal(saved, 1);
      const map = await readAppMap("project", "map");
      const step = map?.tests.checkout?.steps[0] as {
        binding: { cache?: Record<string, unknown> };
      };
      assert.deepEqual(step.binding.cache?.healedFrom, {
        runId: "run-old",
        savedAt: 3,
        reason: "tap failed: no strategy matched",
      });
      assert.deepEqual(step.binding.cache?.steps, [
        { kind: "tap", target: { identifier: "settings-icon" } },
      ]);
    });
  },
);

test(
  "a step whose words changed since the run keeps its old path untouched",
  { concurrency: false },
  async () => {
    await withMap([textStep("s1", "Renamed since the run")], async () => {
      const saved = await saveActCachesFromRun(
        actRun({
          outcome: "passed",
          artifacts: [
            planArtifact(),
            modelResult(
              [{ kind: "tap", target: { label: "Settings" } }],
              [{ strategy: "label", key: "Settings" }],
            ),
          ],
        }) as never,
      );
      assert.equal(saved, 0);
    });
  },
);

test(
  "the acceptance gate in projectPersistedAppMapRun writes, drops, or stays silent by outcome",
  { concurrency: false },
  async () => {
    const { projectPersistedAppMapRun } = await import("./app-map-run-history.js");
    const cached = {
      schemaVersion: 2,
      steps: [{ kind: "tap", target: { label: "Settings" } }],
      runId: "run-old",
      savedAt: 1,
      targetKind: "browser",
      resolution: [{ strategy: "label", key: "Settings" }],
      verification: { runOutcome: "passed" },
    };
    const miss = {
      kind: "act-decision",
      capturedAt: 21,
      data: {
        intent: "Open Settings",
        recipeStepId: "relay-test-s1-1",
        action: "cache-miss",
        reason: "tap failed: no strategy matched",
      },
    };
    const resolution = modelResult(
      [{ kind: "tap", target: { label: "Settings" } }],
      [{ strategy: "label", key: "Settings" }],
    );
    // A blocked run with a miss and a model resolution mutates nothing.
    await withMap([textStep("s1", "Open Settings", cached)], async () => {
      await projectPersistedAppMapRun(
        actRun({
          outcome: "harness-failure",
          artifacts: [planArtifact(), miss, resolution],
        }) as never,
      );
      const stepOf = (value: typeof map) =>
        value?.tests.checkout?.steps[0] as unknown as {
          binding: { cache?: { runId?: string; schemaVersion?: number } };
        };
      let map = await readAppMap("project", "map");
      assert.equal(stepOf(map).binding.cache?.runId, "run-old");
      // A failed run drops the stale path and writes nothing.
      await projectPersistedAppMapRun(
        actRun({
          outcome: "product-failure",
          artifacts: [planArtifact(), miss, resolution],
        }) as never,
      );
      map = await readAppMap("project", "map");
      assert.equal(stepOf(map).binding.cache, undefined);
      // A passed run writes the resolution.
      await projectPersistedAppMapRun(
        actRun({ outcome: "passed", artifacts: [planArtifact(), resolution] }) as never,
      );
      map = await readAppMap("project", "map");
      assert.equal(stepOf(map).binding.cache?.schemaVersion, 2);
    });
  },
);
