import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMapCompiledTest, OfflineTestPreflightReport } from "@relay/protocol";
import {
  createAppMapTestExecutionIntent,
  digestAppMapTestExecutionValue,
} from "./app-map-test-execution-intent.js";
import { compileExecutionRisk } from "./execution-risk-compiler.js";
import { persistRun, readCompletedPersistedRun } from "./runs.js";
import type { TestJob } from "./session.js";
import type { Recipe } from "./recipes.js";
import type { TraceStep } from "./trace.js";

function executionFixture() {
  const root: Recipe = {
    id: "map:test:root",
    title: "Test",
    source: "custom",
    steps: [{ kind: "sleep", ms: 1 }],
    createdAt: 1,
    updatedAt: 1,
  };
  const plan = {
    schemaVersion: 1,
    appMapId: "map",
    appMapRevision: 1,
    test: { id: "test", name: "Test", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: root.id,
    recipes: {
      [root.id]: { id: root.id, title: root.title, parameters: [], steps: root.steps },
    },
    stepProvenance: [
      {
        recipeId: root.id,
        stepIndex: 0,
        recipeStepId: `${root.id}:1`,
        testId: "test",
        testStepId: "authored-step",
        bindingKind: "pause",
        referencedEntityIds: [],
      },
    ],
    performance: {
      executableOperations: 1,
      moduleCalls: 0,
      operationCounts: { sleep: 1 },
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  } as AppMapCompiledTest;
  const preflight: OfflineTestPreflightReport = {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: "map",
    appMapRevision: 1,
    testId: "test",
    planDigest: digestAppMapTestExecutionValue(plan),
    executionRisk: compileExecutionRisk({ kind: "compiled-test", test: plan }),
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
  return { plan, root, preflight };
}

function step(root: Recipe): TraceStep {
  return {
    id: "trace-uuid",
    index: 0,
    recipeId: root.id,
    recipeStepId: `${root.id}:1`,
    kind: "Replay",
    tone: "acc",
    title: "Sleep",
    glyphs: [],
    startedAt: 1,
    finishedAt: 2,
    durationMs: 1,
    frames: [{ path: "frames/001.png", caption: "after", capturedAt: 2 }],
    log: "",
  };
}

test("persistRun stores stable authored-step evidence joins from the frozen intent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-run-step-evidence-"));
  const fixture = executionFixture();
  const intent = createAppMapTestExecutionIntent({
    plan: fixture.plan,
    recipeGraph: { [fixture.root.id]: fixture.root },
    preflight: fixture.preflight,
  });
  const job = {
    id: "run-step-evidence",
    action: fixture.root.id,
    targetContext: { kind: "device", platform: "android", serial: "fixture" },
    targetKind: "device",
    serial: "fixture",
    platform: "android",
    status: "ok",
    queuedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    attempts: 1,
    logs: [],
    steps: [step(fixture.root)],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Test",
    runDir: directory,
    artifacts: [
      { kind: "app-map-test-execution-intent", capturedAt: 1, data: intent },
      { kind: "command-attempt", capturedAt: 2, data: { stepId: "trace-uuid" } },
    ],
    evidence: {
      schemaVersion: 1,
      runId: "run-step-evidence",
      target: { kind: "device", platform: "android", id: "fixture" },
      startedAt: 1,
      channels: {},
      events: [
        {
          sequence: 1,
          at: 2,
          monotonicMs: 1,
          channel: "screenshot",
          kind: "frame",
          stepId: "trace-uuid",
        },
      ],
    },
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
    resolvedInputs: {},
  } as unknown as TestJob;
  try {
    const run = await persistRun(job);
    assert.deepEqual(
      run.testStepEvidence?.map((item) => item.testStepId),
      ["authored-step"],
    );
    assert.deepEqual(run.testStepEvidence?.[0]?.evidence, {
      framePaths: ["frames/001.png"],
      eventSequences: [1],
      artifactKinds: ["command-attempt"],
    });
    const persisted = JSON.parse(await readFile(join(directory, "run.json"), "utf8")) as {
      testStepEvidence?: unknown[];
    };
    assert.equal(persisted.testStepEvidence?.[0] !== undefined, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persisted leftover dest-end Observe last-frame overlays dest wait-for on read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-run-dest-evidence-"));
  const fixture = executionFixture();
  fixture.plan.stepProvenance = [
    {
      recipeId: fixture.root.id,
      stepIndex: 0,
      recipeStepId: "relay-test-step-observe-1",
      testId: "test",
      testStepId: "step-observe",
      bindingKind: "recipe-step",
      referencedEntityIds: [],
    },
    {
      recipeId: "observe-flow",
      stepIndex: 0,
      recipeStepId: "wait-explore",
      testId: "test",
      testStepId: "step-observe",
      bindingKind: "recipe-step",
      referencedEntityIds: [],
    },
  ];
  fixture.preflight.planDigest = digestAppMapTestExecutionValue(fixture.plan);
  const intent = createAppMapTestExecutionIntent({
    plan: fixture.plan,
    recipeGraph: { [fixture.root.id]: fixture.root },
    preflight: fixture.preflight,
  });
  const leftover = {
    schemaVersion: 1 as const,
    testStepId: "step-observe",
    recipeId: fixture.root.id,
    recipeStepId: "relay-test-step-observe-1",
    traceStepId: "trace-module",
    traceStepIndex: 4,
    occurrence: 1,
    evidence: {
      framePaths: ["frames/004.png"],
      eventSequences: [],
      artifactKinds: [],
    },
  };
  const job = {
    id: "run-dest-step-evidence",
    action: fixture.root.id,
    targetContext: { kind: "device", platform: "android", serial: "fixture" },
    targetKind: "device",
    serial: "fixture",
    platform: "android",
    status: "ok",
    queuedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    attempts: 1,
    logs: [],
    steps: [
      {
        id: "trace-module",
        index: 4,
        recipeId: fixture.root.id,
        recipeStepId: "relay-test-step-observe-1",
        kind: "Replay",
        tone: "acc",
        title: "Run saved Test",
        glyphs: [],
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        frames: [{ path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 2 }],
        log: "",
      },
      {
        id: "trace-dest",
        index: 8,
        recipeId: "observe-flow",
        recipeStepId: "relay-test-step-observe-dest",
        kind: "Replay",
        tone: "acc",
        title: "Capture for review · step:step-observe:Observe",
        glyphs: [],
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        frames: [{ path: "frames/003.png", caption: "step:step-observe:Observe", capturedAt: 1 }],
        log: "",
      },
    ],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Test",
    runDir: directory,
    artifacts: [
      { kind: "app-map-test-execution-intent", capturedAt: 1, data: intent },
      {
        kind: "capture-review",
        capturedAt: 1,
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
    evidence: {
      schemaVersion: 1,
      runId: "run-dest-step-evidence",
      target: { kind: "device", platform: "android", id: "fixture" },
      startedAt: 1,
      channels: {},
      events: [],
    },
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
    resolvedInputs: {},
  } as unknown as TestJob;
  try {
    const run = await persistRun(job);
    assert.deepEqual(
      run.testStepEvidence
        ?.filter((item) => item.evidence.framePaths.length > 0)
        .map((item) => item.evidence.framePaths),
      [["frames/003.png"]],
    );
    const parsed = JSON.parse(await readFile(join(directory, "run.json"), "utf8")) as {
      testStepEvidence?: unknown[];
    };
    parsed.testStepEvidence = [leftover];
    const json = JSON.stringify(parsed, null, 2);
    await writeFile(join(directory, "run.json"), json);
    await writeFile(
      join(directory, ".complete"),
      JSON.stringify({
        schemaVersion: 1,
        id: job.id,
        digest: createHash("sha256").update(json).digest("hex"),
      }),
    );
    const overlaid = await readCompletedPersistedRun(directory);
    assert.deepEqual(
      overlaid?.testStepEvidence
        ?.filter((item) => item.evidence.framePaths.length > 0)
        .map((item) => item.evidence.framePaths),
      [["frames/003.png"]],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
