import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyGraph, RecipeStep } from "@relay/protocol";
import type { JobInfo, TraceStep } from "./api-types";
import { projectJourneyRun } from "./journey-run-projection";

const now = 10_000;

function recipeStep(id: string): RecipeStep {
  return { id, kind: "tap", target: { label: id } };
}

function trace(
  index: number,
  status: TraceStep["status"],
  options: Partial<TraceStep> = {},
): TraceStep {
  const startedAt = now + index * 1_000;
  const complete = status !== "running";
  return {
    id: `trace-${index}`,
    index,
    kind: status === "healed" ? "Healed" : "Replay",
    tone: status === "error" ? "fail" : status === "healed" ? "heal" : "acc",
    title: `Step ${index}`,
    glyphs: ["tap"],
    startedAt,
    ...(complete ? { finishedAt: startedAt + 300, durationMs: 300 } : {}),
    frames: complete
      ? [
          {
            path: `frames/${index}-after.png`,
            caption: `after · Step ${index}`,
            capturedAt: startedAt + 250,
          },
        ]
      : [],
    log: status === "error" ? "button was not found" : "",
    status,
    ...options,
  };
}

function graph(): JourneyGraph {
  return {
    schemaVersion: 1,
    screens: [
      { id: "home", title: "Home", createdAt: now, updatedAt: now },
      { id: "details", title: "Details", createdAt: now, updatedAt: now },
      { id: "done", title: "Done", createdAt: now, updatedAt: now },
    ],
    transitions: [
      {
        id: "open-details",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "details" },
        stepIds: ["tap-card"],
        state: "recorded",
        kind: "forward",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "finish",
        fromScreenId: "details",
        destination: { kind: "screen", screenId: "done" },
        stepIds: ["tap-finish"],
        state: "recorded",
        kind: "forward",
        createdAt: now,
        updatedAt: now,
      },
    ],
    flows: [{ id: "main", name: "Main", screenId: "home", createdAt: now, updatedAt: now }],
  };
}

const steps = [recipeStep("tap-card"), recipeStep("tap-finish")];

function job(
  status: JobInfo["status"],
  traces: TraceStep[],
  extra: Partial<JobInfo> = {},
): JobInfo {
  return {
    id: "run-1",
    action: "journey",
    status,
    queuedAt: now - 100,
    startedAt: now,
    ...(status === "ok" || status === "error" || status === "healed"
      ? { finishedAt: now + 2_000 }
      : {}),
    logs: [],
    steps: traces,
    recipeSnapshot: {
      id: "journey",
      title: "Journey",
      source: "custom",
      steps,
      createdAt: now,
      updatedAt: now,
    },
    ...extra,
  };
}

test("projects a passing path, timing, evidence, and traversal order", () => {
  const result = projectJourneyRun({
    graph: graph(),
    recipeSteps: steps,
    job: job("ok", [trace(0, "ok"), trace(1, "ok")], {
      evidence: {
        schemaVersion: 1,
        runId: "run-1",
        target: { kind: "device", platform: "android" },
        startedAt: now,
        channels: {} as JobInfo["evidence"] extends { channels: infer T } ? T : never,
        events: [
          {
            sequence: 1,
            at: now + 250,
            monotonicMs: 250,
            channel: "screenshot",
            kind: "frame",
            stepId: "trace-0",
          },
        ],
      },
    }),
  });

  assert.deepEqual(
    result.traversal.map(({ transitionId, state, connectedFromPrevious }) => ({
      transitionId,
      state,
      connectedFromPrevious,
    })),
    [
      { transitionId: "open-details", state: "passed", connectedFromPrevious: null },
      { transitionId: "finish", state: "passed", connectedFromPrevious: true },
    ],
  );
  assert.equal(result.transitions["open-details"]?.timing.durationMs, 300);
  assert.equal(result.transitions["open-details"]?.evidence.length, 2);
  assert.equal(result.screens.home?.state, "passed");
  assert.equal(result.screens.details?.state, "passed");
  assert.equal(result.screens.done?.state, "passed");
  assert.deepEqual(result.unmapped, {
    graphStepReferences: [],
    recipeSteps: [],
    traceSteps: [],
  });
});

test("attributes a failed step only to its edge and blocks the destination", () => {
  const result = projectJourneyRun({
    graph: graph(),
    recipeSteps: steps,
    job: job("error", [trace(0, "error")], {
      error: "button was not found",
      failureCategory: "locator",
    }),
  });

  assert.equal(result.transitions["open-details"]?.state, "failed");
  assert.deepEqual(result.transitions["open-details"]?.failure, {
    recipeStepId: "tap-card",
    traceStepId: "trace-0",
    message: "button was not found",
    category: "locator",
  });
  assert.equal(result.transitions.finish?.state, "blocked");
  assert.equal(result.screens.home?.state, "passed");
  assert.equal(result.screens.details?.state, "blocked");
  assert.equal(result.screens.done?.state, "blocked");
});

test("keeps a healed edge distinct from an ordinary pass", () => {
  const healed = trace(1, "healed", { heal: "Recovered with a stronger locator" });
  const result = projectJourneyRun({
    graph: graph(),
    recipeSteps: steps,
    job: job("healed", [trace(0, "ok"), healed], {
      healed: true,
      healMessage: healed.heal,
    }),
  });

  assert.equal(result.transitions["open-details"]?.state, "passed");
  assert.equal(result.transitions.finish?.state, "healed");
  assert.equal(result.screens.done?.state, "healed");
});

test("projects a partial active run without marking untouched edges as passed", () => {
  const result = projectJourneyRun({
    graph: graph(),
    recipeSteps: steps,
    job: job("running", [trace(0, "ok"), trace(1, "running")]),
  });

  assert.equal(result.transitions["open-details"]?.state, "passed");
  assert.equal(result.transitions.finish?.state, "running");
  assert.equal(result.activeTraversalOrder, 1);
  assert.equal(result.screens.done?.state, "running");
  assert.equal(result.transitions.finish?.timing.completeness, "partial");
});

test("reports unmapped graph, recipe, and trace steps instead of guessing", () => {
  const broken = graph();
  broken.transitions[0]!.stepIds = ["missing-step"];
  const recipe = [...steps, recipeStep("orphan")];
  const frozen = recipe.map((step) => ({ ...step }));
  const result = projectJourneyRun({
    graph: broken,
    recipeSteps: recipe,
    job: {
      ...job("ok", [trace(0, "ok"), trace(1, "ok"), trace(2, "ok")]),
      recipeSnapshot: {
        id: "journey",
        title: "Journey",
        source: "custom",
        steps: frozen,
        createdAt: now,
        updatedAt: now,
      },
    },
  });

  assert.equal(result.transitions["open-details"]?.state, "unknown");
  assert.equal(result.transitions["open-details"]?.mapping, "unmapped");
  assert.ok(
    result.unmapped.graphStepReferences.some(
      ({ code, recipeStepId }) =>
        code === "graph-step-missing-from-recipe" && recipeStepId === "missing-step",
    ),
  );
  assert.deepEqual(
    result.unmapped.recipeSteps
      .filter(({ code }) => code === "recipe-step-not-in-graph")
      .map(({ recipeStepId }) => recipeStepId),
    ["tap-card", "orphan"],
  );
  assert.deepEqual(
    result.unmapped.traceSteps
      .filter(({ code }) => code === "trace-step-not-in-graph")
      .map(({ traceStepId }) => traceStepId),
    ["trace-0", "trace-2"],
  );
});
