import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapTestStepProvenance } from "@relay/protocol";
import {
  executionIntentPlannedSlots,
  overlayDestEndIdentityEvidence,
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

test("dest-end Observe evidence is dest wait-for, not leftover Run saved Test last-frame", () => {
  const steps = [
    trace({
      id: "trace-module",
      index: 4,
      recipeId: "root",
      recipeStepId: "relay-test-step-observe-1",
      title: "Run saved Test",
      frames: [{ path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 4 }],
    }),
    trace({
      id: "trace-wait",
      index: 5,
      recipeId: "observe-flow",
      recipeStepId: "wait-explore",
      title: 'Wait for label "What should we explore?"',
    }),
    trace({
      id: "trace-dest",
      index: 8,
      recipeId: "observe-flow",
      recipeStepId: "relay-test-step-observe-dest",
      title: "Capture for review · step:step-observe:Observe",
      frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe", capturedAt: 3 }],
    }),
  ];
  const result = projectRunTestStepEvidence({
    steps,
    provenance: [
      provenance({
        recipeId: "root",
        recipeStepId: "relay-test-step-observe-1",
        testStepId: "step-observe",
      }),
      provenance({
        recipeId: "observe-flow",
        recipeStepId: "wait-explore",
        testStepId: "step-observe",
      }),
      provenance({
        recipeId: "observe-flow",
        recipeStepId: "relay-test-step-observe-dest",
        testStepId: "step-observe",
      }),
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "step:step-observe:Observe",
          framePath: "frames/003.png",
          imageSha256: "dest-wait",
          stepId: "relay-test-step-observe-dest",
          phase: "dest",
          policy: "fast",
        },
      },
    ],
  });
  assert.deepEqual(
    result
      .filter((item) => item.evidence.framePaths.length > 0)
      .map((item) => [item.traceStepId, item.evidence.framePaths, item.evidence.artifactKinds]),
    [["trace-dest", ["frames/003.png"], ["capture-review"]]],
  );
  assert.equal(
    result.some((item) => item.evidence.framePaths.includes("frames/004.png")),
    false,
  );
  assert.equal(
    result.some(
      (item) => item.recipeStepId === "wait-explore" && item.evidence.framePaths.length === 0,
    ),
    true,
  );
});

test("dest wait-for still binds when dest screenshot provenance was omitted", () => {
  const result = projectRunTestStepEvidence({
    steps: [
      trace({
        id: "trace-module",
        index: 4,
        recipeId: "root",
        recipeStepId: "relay-test-step-observe-1",
        title: "Run saved Test",
        frames: [{ path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 4 }],
      }),
      trace({
        id: "trace-dest",
        index: 8,
        recipeId: "observe-flow",
        recipeStepId: "relay-test-step-observe-dest",
        title: "Capture for review · step:step-observe:Observe",
        frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe", capturedAt: 3 }],
      }),
    ],
    provenance: [
      provenance({
        recipeId: "root",
        recipeStepId: "relay-test-step-observe-1",
        testStepId: "step-observe",
      }),
      provenance({
        recipeId: "observe-flow",
        recipeStepId: "wait-explore",
        testStepId: "step-observe",
      }),
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "step:step-observe:Observe",
          framePath: "frames/003.png",
          imageSha256: "dest-wait",
          stepId: "relay-test-step-observe-dest",
          phase: "dest",
          policy: "fast",
        },
      },
    ],
  });
  assert.deepEqual(
    result
      .filter((item) => item.evidence.framePaths.length > 0)
      .map((item) => item.evidence.framePaths),
    [["frames/003.png"]],
  );
});

test("overlayDestEndIdentityEvidence replaces persisted leftover last-frame", () => {
  const leftover = projectRunTestStepEvidence({
    steps: [
      trace({
        id: "trace-module",
        index: 4,
        recipeId: "root",
        recipeStepId: "relay-test-step-observe-1",
        frames: [{ path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 4 }],
      }),
    ],
    provenance: [
      provenance({
        recipeId: "root",
        recipeStepId: "relay-test-step-observe-1",
        testStepId: "step-observe",
      }),
    ],
  });
  assert.deepEqual(leftover[0]?.evidence.framePaths, ["frames/004.png"]);
  const overlaid = overlayDestEndIdentityEvidence({
    items: leftover,
    steps: [
      trace({
        id: "trace-module",
        index: 4,
        recipeId: "root",
        recipeStepId: "relay-test-step-observe-1",
        frames: [{ path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 4 }],
      }),
      trace({
        id: "trace-dest",
        index: 8,
        recipeId: "observe-flow",
        recipeStepId: "relay-test-step-observe-dest",
        frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe", capturedAt: 3 }],
      }),
    ],
    provenance: [
      provenance({
        recipeId: "root",
        recipeStepId: "relay-test-step-observe-1",
        testStepId: "step-observe",
      }),
      provenance({
        recipeId: "observe-flow",
        recipeStepId: "wait-explore",
        testStepId: "step-observe",
      }),
    ],
    artifacts: [
      {
        kind: "capture-review",
        data: {
          framePath: "frames/003.png",
          stepId: "relay-test-step-observe-dest",
          phase: "dest",
          policy: "fast",
        },
      },
    ],
  });
  assert.deepEqual(
    overlaid
      .filter((item) => item.evidence.framePaths.length > 0)
      .map((item) => item.evidence.framePaths),
    [["frames/003.png"]],
  );
});
