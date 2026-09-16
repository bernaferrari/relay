import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapTestStepProvenance } from "@relay/protocol";
import {
  executionIntentPlannedSlots,
  projectRunTestStepEvidence,
} from "./run-test-step-evidence.js";
import type { TraceStep } from "./trace.js";

function trace(input: Partial<TraceStep> & Pick<TraceStep, "id" | "index">): TraceStep {
  return {
    kind: "Replay",
    tone: "acc",
    title: "step",
    glyphs: [],
    startedAt: 1,
    frames: [],
    log: "",
    ...input,
  };
}

function provenance(
  input: Partial<AppMapTestStepProvenance> &
    Pick<AppMapTestStepProvenance, "recipeId" | "recipeStepId" | "testStepId">,
): AppMapTestStepProvenance {
  return {
    stepIndex: 0,
    testId: "test",
    bindingKind: "recipe-step",
    referencedEntityIds: [],
    ...input,
  };
}

test("missing or unjoined provenance produces no authored-step evidence", () => {
  const steps = [trace({ id: "trace-1", index: 0, recipeId: "root", recipeStepId: "missing" })];
  assert.deepEqual(projectRunTestStepEvidence({ steps, provenance: [] }), []);
  assert.deepEqual(
    projectRunTestStepEvidence({
      steps: [trace({ id: "trace-2", index: 0 })],
      provenance: [
        provenance({ recipeId: "root", recipeStepId: "step-1", testStepId: "authored-1" }),
      ],
    }),
    [],
  );
});

test("repeated and branched traces retain explicit authored identity and occurrence order", () => {
  const steps = [
    trace({
      id: "trace-branch",
      index: 0,
      recipeId: "root",
      recipeStepId: "branch",
      frames: [{ path: "frames/branch.png", caption: "branch", capturedAt: 1 }],
    }),
    trace({ id: "trace-then-1", index: 1, recipeId: "then", recipeStepId: "tap" }),
    trace({ id: "trace-then-2", index: 2, recipeId: "then", recipeStepId: "tap" }),
  ];
  const result = projectRunTestStepEvidence({
    steps,
    provenance: [
      provenance({ recipeId: "root", recipeStepId: "branch", testStepId: "branch-step" }),
      provenance({ recipeId: "then", recipeStepId: "tap", testStepId: "then-step" }),
    ],
    events: [
      { sequence: 5, stepId: "trace-branch" },
      { sequence: 8, stepId: "trace-then-1" },
      { sequence: 9, stepId: "trace-then-2" },
    ],
    artifacts: [
      { kind: "ui-tree", data: { stepId: "trace-branch" } },
      { kind: "command-attempt", data: { stepId: "trace-then-1" } },
    ],
  });
  assert.deepEqual(
    result.map((item) => [item.testStepId, item.recipeId, item.occurrence, item.traceStepId]),
    [
      ["branch-step", "root", 1, "trace-branch"],
      ["then-step", "then", 1, "trace-then-1"],
      ["then-step", "then", 2, "trace-then-2"],
    ],
  );
  assert.deepEqual(result[0]?.evidence, {
    framePaths: ["frames/branch.png"],
    eventSequences: [5],
    artifactKinds: ["ui-tree"],
  });
  assert.deepEqual(result[1]?.evidence, {
    framePaths: [],
    eventSequences: [8],
    artifactKinds: ["command-attempt"],
  });
});

test("Combine cell child plannedSlots are readable without a digest parse", () => {
  const slots = executionIntentPlannedSlots([
    {
      kind: "app-map-combine-cell-execution-intent",
      data: {
        digest: "not-a-canonical-intent",
        child: {
          plan: {
            plannedSlots: [{ checkpointId: "home", caption: "Home", attempt: 1 }],
          },
        },
      },
    },
  ]);
  assert.equal(slots?.length, 1);
  assert.equal(slots?.[0]?.checkpointId, "home");
});

test("Test execution intent plannedSlots win over Combine cell child", () => {
  const slots = executionIntentPlannedSlots([
    {
      kind: "app-map-test-execution-intent",
      data: { plan: { plannedSlots: [{ checkpointId: "test", caption: "Test", attempt: 1 }] } },
    },
    {
      kind: "app-map-combine-cell-execution-intent",
      data: {
        child: {
          plan: { plannedSlots: [{ checkpointId: "cell", caption: "Cell", attempt: 1 }] },
        },
      },
    },
  ]);
  assert.equal(slots?.[0]?.checkpointId, "test");
});
